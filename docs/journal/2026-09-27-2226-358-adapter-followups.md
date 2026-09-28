ABOUTME: Records card #358, which records a survivor by its executable's whole name, settles past an
unreaped zombie, paces L0's waits, and records only the survivors L0 itself killed.

# 2026-09-27 — The adapter's follow-ups from #354

**`ucomm` cannot say how a name ends.** `ps -o ucomm=` pads a name with spaces to 16 columns even
as the last column, so `a` and `a` with a space print the same bytes, and it holds only the first
16 bytes of a longer name. Trimming only the padding keeps a trailing newline, because `ucomm`
prints it raw, but no trim of `ucomm` alone can keep a trailing space.

**`ps -c` is argv[0], not the executable.** The first round read `ps -c -o command=` for the spaces
a name ends in, on the belief that it printed the executable's name. It prints argv[0]'s last part:
`exec -a Tx` shows `Tx`, and an argv[0] of `w` and two spaces added two spaces to the name `w`. The
probes that misled were all run with argv[0] equal to the executable's path.

**`lsof` gives the whole name, with one ambiguity.** `lsof -F n -d txt` gives the executable's
path, the name whole and unpadded, trailing spaces kept. It escapes a backslash, so a name holding
`\012` and one holding a newline are told apart, but writes a control character as `^` and a
letter and a `^` of the name's own as it is. So the census aligns `lsof`'s name with `ucomm`'s raw
bytes, which settle the first 16, and reads the rest as `lsof` writes. A `^A` of a name's own past
its 16th byte is read as a control character. `pgrep -l -F` prints the name raw, but cut at 15.

**A zombie answers signal 0.** `kill -0` and Node's `process.kill(pid, 0)` both succeed on a zombie
on macOS 27.0. So a survivor that exits on its own and is left unreaped is told from a live one
only by a read of states, which the adapter now takes just before the kill.

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
