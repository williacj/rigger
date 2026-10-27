ABOUTME: Records how card #1010 had L3 close admission on L2's `hold`, with one closer and one
`admission.close` event per card, and what that changed in the tests written under K52's interim.

# L3 closes admission on a hold

K51 and K52 (#740) let a held card end as a stop does until this card: `loop.mjs` threw hold and
stop alike, and the run's memory kept the held card out of later pulls. The hold now closes
admission instead. `loop` builds its one admission handle over the state directory, the run id and
the clock's `now`, as [the #936 ruling](https://github.com/williacj/rigger/issues/936#issuecomment-6385791556)
placed it, and takes the run id `recording` drew, as finding 4 of
[the #937 ruling](https://github.com/williacj/rigger/issues/937#issuecomment-6385791755) has it.
`once.mjs` hands it `opened.run`, so every event and the closer carry one run id.

[The attack](https://github.com/williacj/rigger/issues/1010#issuecomment-6433501768)'s rulings set
where L3 follows a `hold`. Finding 1 places it at the two `advance` calls and at `judged`'s
`ask({ directories })`, through both entry points. A card's first `hold` under its claim links its
closer, and its other judges are not waited for. A later `hold` for the same card under the same
claim links none. Where a judge holds and another judge's refusal escalates, the close comes first,
because `judges` writes the collected escalation only once every judge has settled. Finding 8 has
`loop` refuse, when built, a run id that is not a non-empty string. #1000 changes only what L2
answers, and this card wrote the held judge's wording.

A held card is no longer in the run's memory, so a closer removed before the run's next pull lets
that pull claim it again. A stop keeps its memory. A close that rejects, the closer unsaved or its
event refused, stops every later pull of the loop from claiming. Claims already held still finish.

K52's interim had been tested as an open admission. Four tests asserted that a later invocation
pulls a held card again: three in `environment-retry.test.mjs`, and the lane test's next invocation.
They now remove the closers by hand first, as the owner's `resume` would. That adds lines and
changes none. One test asserted that a hold writes nothing under admission, and it is retargeted
under G1. The multi-card tests holding a card through `heldCard(` are retargeted under G3, since
the hold now leaves the cards after it unclaimed.

The verbs print the hold's closer on a line of its own, in `closerLine`'s words. Its reason holds
`#<card>`, so three existing assertions that a card is named on exactly one line no longer hold.
No grant class covered them, and they were raised on the card before any push.

The verb tests start the bin, so they sit in `test/hold-close-verbs.test.mjs` on the host list
(K97). The L3 tests build `loop` by hand with no process: a provider no adapter is held for makes a maker
or a judge that never started without a spawn.
A leftover temporary file comes from a module the bin preloads, which refuses only that unlink.

## Round 2: a held continuation

The reviewer found a second memory of a held card (1014#6436225316). `work` also remembers a
continuing card whose settle did not succeed, and a continuation held before its maker reaches no
settle. So the card stayed out of the run after its closer was removed. `work` now notes that L2
held the card under its claim, and neither that memory nor the stop memory takes a held card. A
card pulled to remove its directories carries the same continuation, and it is tested too. A card
pulled for its judges alone is remembered only for an escalation or a withheld judge, never a hold.
Its test fails where that memory is made to take a hold.
