<!-- ABOUTME: Records what card #750 learned placing admission and the hold in ARCHITECTURE.md. -->

# Card #750: admission and the hold

The card's budget edit was drafted when the CLI and config row read 1,500. Card #801 then moved
300 lines from L6 to that row, so main read 1,800 when this card was made. The draft's move of 200
lines from L3 was rebased onto 1,800, giving 2,000, because the rows must still sum to the package
total of 12,000. A budget edit written as absolute figures goes stale when another card moves the
same row. Writing it as a move between rows would have survived.

Every "Why" cell in the memory table names what goes wrong without the memory: the next pull in
the same invocation acts on the card again at once. That one test kept two cells from restating
their case (the attack, N2).

The escalated-card sentence in the draft leaned on structure card #749 adds and main does not yet
hold. It now cites `R-ESCALATE-10`, which is ratified on main, so it holds whichever card merges
first.

The first round's judge found that the write adding the status issue's number could rename a closed
record back over `resume`'s removal. A link-based first close guards only against two closes. A
replacing write races every opening too. The fix keeps the draft's two replacing writes, and has
them and every opening take one lock. A close still takes none.

Under first-closer-wins, the owner's `pause` after a hold left the record reading `hold`. Closing the
status issue would then have lifted the owner's pause, which `R-SCHED-23` forbids. Once a lock
exists, a third replacing write costs nothing: `pause` over a hold adds the owner as a second
closer. The lesson is to check every replacing write against the requirement's table of states,
and not only against the race a judge names.

Round 2 found the same fault one level down. A replacing write guarded by "the record still holds
the close I read" still erased an owner added since that read. A guard that compares is weaker
than a rule that rebuilds from a read made under the lock. Round 2 also found that "a continuing
workspace `R-WORK-25` refuses" took in a host fetch failure as well. A citation of a whole row is
wider than the class it means.

Round 4 found the last writer that took no lock: a close. Each earlier fix guarded one writer
against another, and each left an order the guard did not cover. Taking the lock for every write,
closes included, turns every interleaving into some order of writers acting one at a time. A check
then only has to walk the record's five states (absent, `hold`, `owner`, `hold` with the owner
added, unreadable) through each writer once.

After five rounds, the owner ruled (U22) that admission's record becomes one immutable file per
closer, with no lock and no replacing write. The rounds did not converge because of the shape the
card fixed, not the guards. A single record that separate processes read, modify and write needs
mutual exclusion, and a recoverable lock file cannot give it without leases. Giving each closer a
name no other write reuses leaves every write a single `link`, `rename` or `unlink`, so the
interleavings the judges found have nothing left to race on. When three guards in a row each open
the next interleaving, question the data's shape before writing a fourth.

Round 6 found that `.tmp-<process>` breaks for two holds in one engine. A second write either finds
the name taken, or writes through the first closer's inode and changes a published closer. Naming
each temporary file by an id of its own, and unlinking it once the closer is linked, means no write
shares a temporary file and every closer ends with one name. A per-process name was the old lock
design's habit carried over. Under a no-shared-names rule, every file needs a name of its own.
