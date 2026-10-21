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
