ABOUTME: Journal for #517 (M4-F8): two census tests' reached checks now name the class of read
that was cut, so a later read, or a read of the other class, cannot satisfy them.

# #517 — each class of cut read marks a file of its own

**One marker stood in for every read.** The census-and-kill test and the leader-and-zombie test
each wrote one `cut` file from every read their `ps` stand-in cut, and checked only that it
existed. At the base, four mutations each left one class of read uncut, and the test still passed
every time. In the census-and-kill test, the census's `-ww -g` reads alone or the kill's `ppid=`
reads alone wrote `cut`. In the leader-and-zombie test, a read after the census's wrote it, as did
any read other than the kill's.

**A probe of the stand-ins' arguments showed where the kill's read comes from.** In the
leader-and-zombie test, the timeout's containment never reaches the kill: every census read leaves
out the leader, so the census runs out its `readTimeout` and the group is killed whole. The kill's
`ppid=` read happens in the containment after the command exits. By then the leader has been
reaped, so the census names no survivor, and `killing` still makes its first read of the group.
That one read lists the zombie, so a kill marker is set on every run and not by chance.

**Each stand-in now writes `census.cut` and `kill.cut`, and each test checks both.** Each check's
message names its class. The stand-ins keep their outer `case` line, so one textual mutation
leaves the same class uncut at the base and at the head. Under each mutation, the head fails at
the check for the class it left uncut. With the cutting branch removed whole, both tests fail at
their census check.
