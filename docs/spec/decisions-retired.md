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

## D19 — Until M5, a maker merges its own card

**Status:** Superseded by D22.

### Rule

1. Until M5, a maker merges its own card once `R-GATE-4`'s evidence is in hand, and never
   otherwise. `AGENTS.md`, under "Review and merge", holds it.
2. The permission reaches the merge alone. This decision leaves self-ratifying and judging one's
   own work exactly where it found them, so every verdict the merge rests on is another role's.
3. M5 reverses this decision. `docs/v0-build-plan.md` installs the git gate hook there, and the
   permission ends with it.
4. The permission reaches a card changing any path `AGENTS.md`'s "Self-hosting" section lists,
   on the same evidence as any other card. That section states it, beside its rule that the engine
   never merges such a change, which this decision leaves where it found it.

### Notes

`AGENTS.md` forbade a maker merging its own work in words carrying no exception, and rule #1 of
that file forbids a session granting itself one. So a dispatched maker read the prohibition and
stopped, which is the behaviour the file exists to produce.

That behaviour is why the permission could not live in a dispatch brief. Card #187 records what M0
saw: sessions met the gate refusing `--no-verify`, and refusing `-c core.hooksPath=` at its
correct value, and each surfaced the refusal rather than routing around it. A brief telling a
maker it may merge, against a binding document saying it may not, asks the session to take the
brief over the document.

The end was settled before this entry was written. `AGENTS.md`'s "Version control" gives the gate
rule to the owner to waive until M5, and `docs/v0-build-plan.md`'s M5 is where the hook arrives.
So rule 3 reads a reversal the binding documents already carried, rather than inventing one.

A forge ruleset is a backstop under the permission rather than a substitute for a verdict.
Measured with `gh api repos/williacj/rigger/rulesets/23968611` on 2026-09-24, `main`
carried an active ruleset. It required a pull request and the `check (20)` and `check (24)`
status checks, blocked non-fast-forward and deletion, and held `bypass_actors` empty. So a maker
merging through the forge could not merge a red branch or rewrite history. What no ruleset reads
is a verdict, which is what rule 1 asks for.

This decision adds no requirement. It binds the sessions working in this repository rather than
Rigger's behaviour, and `docs/spec/requirements.md` holds only the second.

Rule 4 records the owner's ruling of 2026-09-24, which card #197 carries. `AGENTS.md`'s
"Self-hosting" section said those cards are done by hand, and named no permission. Its "Version
control" section sets working by hand against being a dispatched session. So a dispatched maker
holding the evidence on such a card had reason to stop. Rule 1 already reached every card a maker
owns, so rule 4 adds within this decision's scope rather than changing rule 1.

"Done by hand" meant that no engine dispatch works such a card, and `docs/v0-build-plan.md`'s
self-hosting premise reads it that way. `AGENTS.md` now says so in those words, so the phrase no
longer stands where a dispatched maker reads it as a bar on itself.

The engine's rule stays because it guards a different thing. An engine merging a change to its own
gate, config or entry point replaces what it is running under. A maker the engine did not dispatch
replaces nothing it runs under, so the evidence that admits any other card admits this one.

One signal ends the permission before M5. Where a maker merges on evidence a judge later rules
incomplete, the permission is costing more than the round it saves, and the owner withdraws it.
