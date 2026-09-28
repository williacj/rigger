ABOUTME: Records card #358, which names a survivor by what `ucomm` holds, settles past an unreaped
zombie, paces L0's waits, and records only the survivors L0 itself killed.

# 2026-09-27 — The adapter's follow-ups from #354

**`ucomm` cannot say how a name ends.** `ps -o ucomm=` pads a name with spaces to 16 columns even
as the last column, and holds only a name's first 16 bytes. So `sp` and `sp` with a space print
the same bytes, and so do `abcdefghijklmno`, the same with a space, and the same with a space and
`x`: every `ucomm` form `ps` offers, under every locale tried, printed them alike. Trimming only
the padding keeps a trailing newline, because `ucomm` prints it raw, but no read of `ps` keeps a
trailing space.

**`ps -c` is argv[0], not the executable.** The first round read `ps -c -o command=` for the spaces
a name ends in, on the belief that it printed the executable's name. It prints argv[0]'s last part:
`exec -a Tx` shows `Tx`, and an argv[0] of `w` and two spaces added two spaces to the name `w`. The
probes that misled were all run with argv[0] equal to the executable's path.

**`lsof` was tried and taken out.** The second round read the executable's path with `lsof`, which
keeps the whole name. The card's author then ruled that the adapter names a survivor only from its
process-table reads, which the Failure model excepts, so a name is what `ucomm` holds.

**A zombie answers signal 0.** `kill -0` and Node's `process.kill(pid, 0)` both succeed on a zombie
on macOS 27.0. So a survivor that exits on its own and is left unreaped is told from a live one
only by a read of states, which the adapter takes just before the kill. Where that read fails, the
survivors go unnamed, as they do when the census fails.

**A read that fails must not hold the wait.** The first round counted a failed read of states as
finding a live member, so a zombie never reaped and a `ps` that failed or hung kept the call
waiting for ever (both judges on #363). Now only a read that finds a member that is not a zombie
restarts `UNREAPED_BOUND`.

**The sandbox throttles the processor.** Inside this session's sandbox, a tight `while` loop in
Node used 17% of a core over two seconds. Outside it, the same loop used 99%. So a figure of
processor time measured inside it understates a spin. The figures below were measured outside it.

**The base's loops used well under a full core.** Over a wait on a group that a never-reaped zombie
keeps in being, `setImmediate` polling with two `kill` calls a turn used 738 to 797 ms of the
processor over 2,000 ms, in three runs with Node 26.5.0, and the paced loop 12 to 14 ms. The card's
author then set the bound at a tenth. A census test whose `ps` stand-in was a shell script kept a
census re-reading on every turn under that bound, because every read paid for a shell's start, so
the stand-in is compiled.

**The zombie bound is there for processes that join late.** A group holding only zombies runs
nothing, but the test of a process that joins the group after the kill needs L0 to go on killing
while a zombie keeps the group in being. Over 30 calls of the three tests whose zombie is reaped,
the group was empty 2 to 5 ms after L0 first read only zombies. `UNREAPED_BOUND` is one second.
