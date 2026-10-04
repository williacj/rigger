ABOUTME: Journal for #586 (M4-F28): a member L0 could not end, under a table that fails every read
after the kill, is no longer recorded as killed on the call's containment or a start's kill.

# #586 — a member the kill left alive, unread after the kill

**Why.** On the call's containment and a start's kill, `ended` counted a failed read after the kill
as an empty listing. Once `UNREAPED_BOUND` passed it settled with no member it could not end, and
`killsOf` recorded every member the read before the kill had found alive as killed. That included a
member the kill left alive and one that answered `EPERM`. The card's first commit reproduced all
four cases at `605ca06` before any fix.

**What changed.** Where a read after the kill failed, `contain` now asks each member the read before
the kill named, by pid, whether signal 0 still reaches it (`reachedUnread`). One that answers
`EPERM` is recorded as unended for `EPERM`. Any other that answers is recorded as not shown to have
ended. The census had named each of them, so each keeps its name and command line.

**The limit.** Signal 0 reaches a zombie as it reaches a live process. So where reads fail, a member
the kill ended but nobody has reaped is recorded as not shown to have ended rather than as killed.
That errs toward `R-STATE-19`, and the code states the limit under `D16` rule 3.

**Host.** On the Linux cloud container, cases c and d fail before reaching the code under test.
The start's read of start times lists no process of the group there, as it does for the base's own
start-kill tests in this file. Their evidence is macOS CI's (O86).
