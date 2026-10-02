ABOUTME: Journal for #541 (M4-02c): the Failure model now says L0 resumes a process that left its
group while L0 held the group stopped, as architect ruling 11 on #467 proposes.

# #541 — a process Rigger stopped is never left stopped

**Why the sentence changed.** #539 found that a child which calls `setsid` while L0's census holds its
group stopped leaves the group already stopped. The census never reads it and the kill misses it, so
it sits under pid 1, stopped, for good. The Failure model said only "A process that leaves its group
is outside this containment." Ruling 11 holds that this sentence assumes the process was free when
it left. This one was not: L0's own stop reached it, and only that stop keeps it from running or
exiting.

**Resume, not kill.** Killing the process would reach past `R-STATE-17`, which puts a process
outside every group Rigger created, and outside every dispatch's directory, beyond the rule. It could
also end a consumer's own `git maintenance` mid-run. Resuming puts the process where it would have
been had the stop never reached it, which is outside containment, as the existing sentence promises.
Where it works in a dispatch's directory, the census that follows still ends it. L0 records each
resume by name and command line.

**Order.** This is a proposal, and the owner's merge ratifies it (`D21`). #539's fix merges only
after it.
