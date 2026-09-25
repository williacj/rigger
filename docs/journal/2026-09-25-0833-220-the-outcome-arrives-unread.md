ABOUTME: Records card #220, which gave L2 every change to a card's column, and why the outcome L3
hands over is a settled-promise record and the event is written only after the move.

# 2026-09-25 — The outcome arrives unread

L2 now makes the two column changes M1 needs: a claimed card from `ready` to `coding`, and a
returned dispatch's card from `coding` to `review`. `src/workflow/transitions.mjs` holds both,
beside the next action they follow from.

**The outcome is what `Promise.allSettled` makes of the dispatch.** R4-B2 has L3 pass every
outcome to L2 without inspecting it. M1 has no L1 yet, and nothing fixed what an outcome looks
like. The settled record is the one shape L3 can build without reading anything:
`{ status: 'fulfilled', value }` for a dispatch that ran, where `value` is L1's result
`{ exit, output }`, and `{ status: 'rejected', reason }` for one that threw before it ran. Anything
else is refused, naming the card, because reading an unknown shape as a failure would hide a fault
in L3.

**The wrapper is not the verdict.** The first cut read every fulfilled outcome as returned, so a
dispatch that ran and exited non-zero reached `review`. Both round-1 judges found it. L1 resolves
for a dispatch that ran whatever it exited, because what the result means is not L1's to decide,
so "did not throw" says nothing about whether the work failed. The owner ruled that the exit code
alone decides: zero moves the card to `review` whatever the output says, and anything else leaves
it in `coding`. The tests pair each exit code with output saying the opposite.

**The event follows the move, never the other way.** The event is written once the board has
taken the move, so a refused move records nothing and its caller is told the card and the column.
A mutation that writes the event first reds both the refusal test and the check that no event lacks
a matching move. That check is the one `R-WORK-5`'s measure names: a transition the board never
received.

**The change is fixed by its cause, not read off the card.** L3 still holds the card as it read
it, in `Ready`, when it hands over the outcome. Taking the column left from that read would record
a return as leaving `ready`. Each cause therefore names its own two column keys, and neither enters
`ready`.

**A red test reached the real board.** The first run of the wiring test passed a `send` that L2 did
not yet forward, so the item-write side spawned `gh` for real. It read board 6 and sent one column
move naming the test's made-up item ID. GitHub refused it, because no node has that ID, and
nothing on the board changed. Forwarding `send` is what turned the test green, and from then on the
test's stub answers every request. But the runners default to the real spawn, so any change that
drops the forwarding sends this test's move to board 6 again. Nothing stops that yet, here or in
any other test that injects `send`.
