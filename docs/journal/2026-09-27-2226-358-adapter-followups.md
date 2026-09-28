ABOUTME: Records card #358, which keeps a survivor's trailing whitespace in its recorded name, settles
past an unreaped zombie, paces L0's waits, and records only the survivors L0 itself killed.

# 2026-09-27 — The adapter's follow-ups from #354

**`ucomm` cannot say how a name ends.** `ps -o ucomm=` pads a name with spaces to 16 columns even
as the last column, so `a` and `a` with a space print the same bytes. Trimming only the padding
keeps a trailing newline, because `ucomm` prints it raw, but no trim of `ucomm` alone can keep a
trailing space. `ps -c -o command=` prints the executable's name unpadded, so the census reads it
for the spaces a name ends in. It is no replacement for `ucomm`: it escapes a newline as `\012`
and leaves a literal backslash alone, so the two cannot be told apart. `pgrep -l -F` prints the
name raw and unpadded too, but cut at 15 bytes, and the census's other reads already go through the
`ps` the caller names.

**A zombie answers signal 0.** `kill -0` and Node's `process.kill(pid, 0)` both succeed on a zombie
on macOS 27.0. So the kernel can tell L0 that a survivor has gone only once it has been reaped, and
a survivor that exits on its own and is left unreaped is still recorded as killed. The census's
last read of states is the latest point a zombie shows, and a read added after it would narrow
nothing.

**The sandbox throttles the processor.** Inside this session's sandbox, a tight `while` loop in
Node used 17% of a core over two seconds. Outside it, the same loop used 99%. So a figure of
processor time measured inside it understates a spin, and the tests that bound the waits'
processor time would pass a spinning loop there. The figures below were measured outside it.

**The base's confirmation loop used about 0.4 of a core, not a full core.** Over a wait on a group
that a never-reaped zombie keeps in being, `setImmediate` polling with two `kill` calls a turn used
738 to 797 ms of the processor over 2,000 ms, in three runs with Node 26.5.0. The paced loop used
12 to 14 ms. So the card's bound of half the wait holds for the base's loop on this host too, and
the tests show they discriminate with a pause that busy-waits instead. The census's re-reads at
the base used 49 to 93 ms over re-reads of 546 to 1,415 ms, because each re-read awaits a `ps` run,
and the pause took them from 58 to 155 reads down to 26 to 28.

**The zombie bound is there for processes that join late.** A group holding only zombies runs
nothing, but the test of a process that joins the group after the kill needs L0 to go on killing
while a zombie keeps the group in being. Over 30 calls of the three tests whose zombie is reaped,
the group was empty 2 to 5 ms after L0 first read only zombies. `UNREAPED_BOUND` is one second.
