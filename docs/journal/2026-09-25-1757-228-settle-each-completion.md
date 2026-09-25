ABOUTME: Records card #228, which has L3's run refill each freed slot and proves each card's
settling and the config's column names through that run.

# 2026-09-25 — L3 settles each completion

`loop().run()` fires the pull trigger, and fires it again each time a slot the run filled is
released. So a card whose dispatch returns lets the next pullable card start while the others
still run. `pull()` keeps its one-shot shape. That change is 9096678, written by the card's
first maker session, which died before it could push. A second session resumed from that commit
and did the rest.

**Only the first item needed code.** Claim-before-dispatch, settling through L2 and the
config's column names were already true of #227's loop and #220's L2. The remaining items are
tests over `run()`. Each one passed as soon as it was written, so a guarded mutation run shows
that each discriminates. The PR lists every mutation and the tests it redded.

**The world helpers now carry column names, a priority and one sequence record.** A board move is
recorded once the board has made it, and a dispatch start is recorded as it begins, both in one
array. That is what lets one assertion say "moved before started" for every card. The column
read now goes through the fake board's `readPriority`, which answers the same shape the read
side does, so one helper serves both the no-priority runs and the priority-ordered one.

**A run over a board that refuses a claim move never ends.** The refused card is still in Ready
with its slot free, so the run pulls it again at once. Against the fake board every step is a
resolved promise, so the run never yields to the event loop. A probe over a board refusing
every move was killed by a 60-second timeout without printing anything. Against the real forge,
the same retry would go on without bound, one round trip at a time. No acceptance item covers
this. The fix means choosing between approaches, for example not refilling a slot whose work
failed, or leaving the bound to the admission halt (`R-SCHED-4`). So it goes to the owner in
the PR rather than being decided here.
