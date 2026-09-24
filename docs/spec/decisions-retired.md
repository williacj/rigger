ABOUTME: Bodies of Rigger decisions that a later decision superseded, kept for the reasoning rather than for the rule.

# Retired decisions

Nothing here binds. Read it for why a choice was made and why it changed. `docs/spec/decisions.md`
states when a decision arrives here.

## D4 — v0 defers the roles it can do without

**Status:** Superseded by D18.

### Rule

1. v0 gives a maker and its judges no adjudicator. `R-LOOP-9` and `R-LOOP-10` hold what follows:
   disagreement is bounded by rounds rather than settled by a third role.
2. No role owns the requirements: the PM proposes them and the owner ratifies them.
3. v0 has no architect. A delta to `ARCHITECTURE.md` comes from whichever role needs it, and goes
   to the owner.

### Deferred, and what returns it

| Deferred | Returns when |
|---|---|
| An adjudicator role, and the triage lane that routes to it | `report` shows escalation volume the owner cannot absorb, or shows rounds exhausting on disagreements a third role could settle. Adding the lane's column to a board already in use is the first test that board columns can change. |
| An architect role | Decompositions escalate as `ambiguous` on layer-boundary questions, or reviews keep finding boundary violations the lenses missed. |
| A role that owns the requirements, distinct from the PM who proposes them | A judge returns the same card twice for an acceptance that contradicts a requirement, or the owner rejects a proposed requirement that the register already answered. |

### Notes

A role is never free. Each one adds a dispatch, a prompt to maintain, and a path for work to take.
v0 buys the cheaper arrangement first and measures whether it hurts, rather than staffing against a
problem it has not had.

The roles deferred here would do real work. An adjudicator settles a maker and judge who cannot
agree. An architect holds the layer boundaries across cards that no single card shows. v0 gives
both jobs to the owner, who is already in the loop for every architecture delta.

This decision expires. What does not change is elsewhere: D3 holds the escalation rule, and
`ARCHITECTURE.md` holds the maker and judge structure.
