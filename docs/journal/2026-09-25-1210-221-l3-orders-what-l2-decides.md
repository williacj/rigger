ABOUTME: Records card #221, which gave L3 its pull order, and the seams it had to leave for the
cards on either side of it: the L0 hand-off (#224) and L2's redo next action (#230).

# 2026-09-25 — L3 orders what L2 decides

`pullOrder` in `src/scheduling/pull-order.mjs` takes the board's cards, the declared columns and
the declared priority order, plus L2's next-action function. It returns the pulls, redos first,
each group ranked by declared option and then by issue number, and it returns L2's refusals beside
them.

**L3 takes L2 as a function because the boundary test leaves no other route.** Rule 2 bars
`src/scheduling/` from naming `kinds`, `labels` or `body`. So L3 cannot call `nextAction` with the
config's kinds, and cannot look at a card's labels to guess. The caller binds L2's function over
the config and hands it in. L3 passes each in-scope card through to it unread.

**The priority hand-off is fixed here before L0 builds it.** Each item carries
`priority: { value, declared }`, and the order arrives as `declared`, a list or null. That is the
shape #224's "Lands in" describes: the value, whether the declaration names it, and the declared
order. Until #224 lands, the test does that hand-off from the fake board's `fieldValues`. Its
helper, `handOff`, is what #224's read replaces.

**`declared: false` carries the shared bottom rank, not `indexOf`.** The draft review's
counterexample was an undeclared value getting `-1` from `indexOf` and sorting first. The first
green here did exactly that. Two tests went red on it, the no-value one and the undeclared one. The
tie between those two cases passed by accident, since both sat at `-1`. A mutation that split them
(no value below undeclared) is what showed the test discriminates.

**Freshness and the claim are not L3's, so this card only leaves room for them.** L2 decides
whether a Coding or Review card is a redo. The test injects freshness into its stand-in for L2,
and a fresh card comes back ignored. Building L2's real next action for those columns is #230's
work. No claim set exists before #227, so every card counts as unclaimed.
