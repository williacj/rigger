ABOUTME: Journal for #517 (M4-F8): two census tests' reached checks now name the class of read
that was cut, and the leader-and-zombie test's check counts only a kill read made while its leader
lives.

# #517 — each reached check names the read it needs

**One marker stood in for every read.** The census-and-kill test and the leader-and-zombie test
each wrote one `cut` file from every read their `ps` stand-in cut, and checked only that it
existed. At the base, four mutations each left one class of read uncut, and the test still passed
every time. In the census-and-kill test, the census's `-ww -g` reads alone or the kill's `ppid=`
reads alone wrote `cut`. In the leader-and-zombie test, a read after the census's wrote it, as did
any read other than the kill's.

**The census-and-kill test now marks each class in a file of its own.** Its stand-in writes
`census.cut` and `kill.cut`, and the test checks both, each message naming its class.

**Splitting the marker by class was not enough for the leader-and-zombie test.** Round 1 split its
marker the same way. The engineer judge then showed a later read of the same class satisfying it.
A probe of the stand-in's arguments at the base had shown why. The timeout's census never
completed, because each of its reads left out a leader that still answered signal 0, so the census
read again until it gave up. The group was then killed whole, and the kill's first `ppid=` read
came only in the containment after the command exited, with the leader already reaped. So the kill
the title names, made while the leader lives, never happened. The card's author amended the
acceptance under `R-LOOP-6`.

**The census now reads the group uncut, and the kill's mark counts only while the leader lives.**
A census that lists the leader completes during the timeout's containment, so the kill runs there
and its first read of the group is cut to the zombie's row. The stand-in writes `kill.cut` only
where that read listed the zombie while the leader, whose pid is the group's, answers signal 0. A
probe at the revised head shows the read happening with the leader answering, and the event that
follows is `timeout.killed` for the leader. Every kill read after the leader was gone found it
not answering, and none of them can write the mark.
