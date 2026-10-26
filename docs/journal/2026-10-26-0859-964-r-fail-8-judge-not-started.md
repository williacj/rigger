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
none. An agent file or a settings file is read from the main line, the same for every card
(`R-LOOP-14`), and the owner kept those host (U72). Every cause that can stay until a person acts
is classed host, so the hold tells the owner (`R-SCHED-7`). The owner ruled that the same judge's
next dispatch for the card, failing the same way, is the second attempt (U72).

The first round classed the causes that usually pass, such as a host short of processes or a
Codex skill check past its time, `out` with U43's outcome. All three judges found a counterexample:
each can also last, and then it spins in silence. Host costs nothing for a cause that passes,
since only a second failure the same way closes admission. They also found rows holding three or
more conditions, which spec-style rule 4 splits one condition to a row.

Open cards whose bodies cite the literal `R-FAIL-7` when the head was pushed, by an exact match
over the bodies of all 31 open issues: #964 alone. The PM retargets a card body only where its
acceptance turns on the added rows.

#967 (#961) merged before this card, adding `R-FAIL-7` citations to `ARCHITECTURE.md`. This pull
request merged `main` and retargeted them, id only, under the architect's delta the card records.

What taught us: "passes by itself" is a judgment about the usual case. A requirement row has to
hold for the case that lasts, so test each cause's persistence against its worst case.
