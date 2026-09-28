ABOUTME: Records card #337, which bounds L0's read of output that a process outside the command's
group holds open, and has a refused kill event reach the caller without stopping any kill.

# 2026-09-27 — The adapter stops waiting on a detached holder, and reports refused kill events

**Settling is not letting go.** The first way to stop reading a held pipe that comes to mind is to
settle the call and leave the streams alone. A guarded mutation did exactly that: it emitted
`close` on both streams instead of destroying them. Every test that awaits the call stayed green,
but a caller in a process of its own never exited, because the open pipe handles held its event
loop. So the adapter destroys both streams once the bound passes, and one test runs the call in a
separate Node process and waits for that process to exit while the holder is still alive.

**The holder must leave before the command exits.** A holder that is still in the group when the
command exits dies in the group kill, and the test then proves nothing (engineer, round 2, 10).
macOS has no `setsid` binary, so the fixture's holder is perl running `setpgrp(0, 0)`. It writes a
marker file once it has left, and the command waits for that file before it exits. Every such test
asserts that the holder is alive when the call settles, or when the caller exits, so a holder
that died early reds the test rather than passing it.

**The bound's premise is measured, and the bound itself is a judgment.** With nothing outside the
group holding a pipe, both pipes closed at most 0.129 ms after the group was empty. That is over
400 calls writing 300,000 bytes each, half of them leaving a survivor on both pipes, with Node
26.5.0 on macOS 27.0. `OUTPUT_BOUND` is one second, so a command whose output a detached process
holds costs one second.

**All recording moved after the output read.** The failure for a refused event must carry the
command's result, and the result is known only once the pipes are read. So the adapter now kills,
confirms the group is empty, reads the output, and only then tries every append. The kills are
all done before the first append, whichever order the appends take. Each refused event goes into
the failure, whether it is a survivor's kill, the group's kill after a failed census, or the held
output. The failure's `code` is `EVENT_REFUSED`, while a command that never started rejects with
the spawn's own code, such as `ENOENT`.

**A real sink refuses when its directory sits under a file.** The tests need no fake emitter to
get a refusal. They open the sink with its state directory under a regular file, so the sink's
`mkdir` fails on every append.

**`rigger-process-` is not only this session's prefix.** A `pgrep` for the scratch prefix after a
run found two processes that belonged to another session running the same test file, and they had
ended a moment later. Every test's teardown finds its own fixtures by its own directory, which no
other session shares, so a check for leftover processes has to look for that directory too.
