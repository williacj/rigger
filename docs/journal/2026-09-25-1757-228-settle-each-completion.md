ABOUTME: Records card #228, which has L3's run refill each freed slot and proves each card's
settling and the config's column names through that run.

# 2026-09-25 — L3 settles each completion

`loop().run()` fires the pull trigger, and fires it again each time a slot the run filled is
released. So a card whose dispatch returns lets the next pullable card start while the others
still run. `pull()` keeps its one-shot shape. That change is 9096678, written by the card's
first maker session, which died before it could push. A second session resumed from that commit
and did the rest.

**Of the card's first nine items, only the first needed code.** Claim-before-dispatch, settling through L2 and the
config's column names were already true of #227's loop and #220's L2. The remaining items are
tests over `run()`. Each one passed as soon as it was written, so a guarded mutation run shows
that each discriminates. The PR lists every mutation and the tests it redded.

**The world helpers now carry column names, a priority and one sequence record.** A board move is
recorded once the board has made it, and a dispatch start is recorded as it begins, both in one
array. That is what lets one assertion say "moved before started" for every card. The column
read now goes through the fake board's `readPriority`, which answers the same shape the read
side does, so one helper serves both the no-priority runs and the priority-ordered one.

**A run over a board that refused a claim move never ended.** The refused card was still in
Ready with its slot free, so the run pulled it again at once. The owner ruled on 2026-09-25 that
the fix belongs in this card. The PM then added three items: over a board refusing every claim
move, one `run()` settles, the board receives at most one claim request per card, and it
receives no read after the first refusal. A slot freed by a refused claim now fires nothing, so
the card waits for the next trigger. The loop keeps no memory of refused cards.

The first report of this defect cited a probe "killed by a 60-second timeout". That claim was
wrong. macOS has no `timeout` command, so the probe never ran, and the empty output was the
shell's "command not found" filtered away by `grep`. The added tests measured the defect
instead. Before the fix, five turns of the event loop brought 62 claim requests, which is
2 + 4 + 8 + 16 + 32. That is because each refused pair freed two slots, and each freed slot
fired a pull that claimed two more.

**A refusing run is bounded by the test.** Each pull the test's board handle serves waits one
turn of the event loop before it reads. The test gives the run five turns to settle, then makes
any later read fail. So even the unfixed loop reached a verdict rather than hanging the file.
