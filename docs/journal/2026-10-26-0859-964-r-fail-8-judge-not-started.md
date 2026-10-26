ABOUTME: Records card 964's proposal that withdraws R-FAIL-7 for R-FAIL-8, classing a judge's dispatch that never started.

# Card 964: R-FAIL-8 classes a judge's dispatch that never started

[#964](https://github.com/williacj/rigger/issues/964) proposes the rows
[U45](https://github.com/williacj/rigger/issues/740#issuecomment-6377288414) deferred: a judge's
dispatch that never started for a cause other than its directory, its scratch directory or a
`head` step. [U43](https://github.com/williacj/rigger/issues/740#issuecomment-6377288414) classed
a judge's scratch directory not made for a host cause as `out`, and those rows stay as they are.
[U71](https://github.com/williacj/rigger/issues/740#issuecomment-6417450089) widens the table, so
`R-FAIL-7` retires and `R-FAIL-8` takes its place. The 34 test claims retarget under grant class
G1.

The evidence is finding 5 of [the #920 attack](https://github.com/williacj/rigger/issues/920#issuecomment-6377073780).
It read that such a judge is dispatched again at once, for as long as the failure lasts. That
reading still holds at `533ea6b`, though by another route: L3 hands back the judge's outcome as a
rejected settlement, and `rigger once` says the judge "did not start". The reading is not a
measurement.

[K80](https://github.com/williacj/rigger/issues/740#issuecomment-6417606019) allows a card-local
judge row only where `R-ESCALATE-12`'s first sentence already covers the cause. The proposal adds
none. Every adapter refusal reads the main line, the same for every card (`R-LOOP-14`). Causes
that stay until a person acts are classed host, so the hold tells the owner (`R-SCHED-7`).
Causes that pass by themselves take U43's outcome. Whether a judge's next dispatch counts as the
card's second attempt goes to the owner as an open question.

Open cards whose bodies cite the literal `R-FAIL-7` when the head was pushed, by an exact match
over the bodies of all 32 open issues: #961 and #964. The PM retargets a card body only where its
acceptance turns on the added rows.

What taught us: the architect's attack read a judge's adapter directory as outside the judge's
directory. `makeJudgeDirectory` puts `main` inside it. Open the path's maker before ruling on what
a directory "shows".
