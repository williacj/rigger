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
