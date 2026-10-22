ABOUTME: Records the placement and limits of routing a maker's escalation to a role under card #751.

# Card #751 — a role handles a maker's ambiguity inside the attempt

The routing decision belongs in L2's one escalation function because it reads the category,
raiser, kind and issue comment together. L3 dispatches the chosen role in place of judges under
the card's existing claim and slot. Keeping this within the attempt avoids a second board state
for work that is still waiting on the same maker's escalation.

L2 writes the routing comment before L3 dispatches the role. A crash after the comment can send
the next maker note to the owner, so the design fails closed without persisting a separate
"handled" state. A person can delete the comment and reopen the route. The same role may also
judge a card of another kind, so its escalation directory sits under `escalations/` rather than
sharing `judges/`.

The role's dispatch that never started is retried alone. A refused escalation directory is a
different failure: L1 refuses it under `R-WORK-32`, and L2 sends the card to the owner without a
retry. The latter outcome still lacks a requirement row, as #751 records; this structure states
the architect's ruling without changing the requirements register.

The extension row names destinations before the published config shape changes. M6-19 owns that
shape beside its validator, whose test holds the two together. Until M6-19 merges, the row and
the published example describe different stages of the planned configuration change.

At round 2 the proposal passed from a Codex maker to a Claude architect, because the gate fixes
this kind's reviewer on Codex (K46 on #740). The review input found two rules carried in prose
that spec-style rule 4 wants as lists. The owner-override's three conditions are now a list
under the test they share. The role's dispatch outcomes are now two lists: what a clean exit
leads to, keyed by what the forge holds, and the two ends that escalate. Each keeps the draft's
meaning, and the pull request lists both as departures. A list makes each condition a separate
line that M6-19, M6-20a and M6-20b can each test against, where the prose chain left a reader to
work out which clause governed which outcome.

The round-2 judge found two more form defects. The validator's five refusals in the
"Escalation destinations" row were one chain, so they now take a lead row and one continuation
row each, as the requirements register does for `R-GATE-4`. The role paragraph retyped
`R-ESCALATE-23`, so it now refers to that row for the card's column and label while the role
works, rather than restating it.
