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

## D21 — Until M5, the owner's merge is the owner's ratification

**Status:** Superseded by D25.

### Rule

1. Until M5, the owner ratifies a proposal by merging its pull request, and needs no separate
   verdict to do so. Each register's preamble holds it.
2. Until M5, on a card whose kind names `owner` among its judges, the owner's merge is the owner's
   verdict.
3. So the maker of such a card never holds `R-GATE-4`'s evidence before the card merges, and
   `D22` rule 1 never lets it merge that card. The owner merges it. `AGENTS.md`, under "Review
   and merge", holds it.
4. A merge by anyone but the owner ratifies nothing. This decision leaves every other judge's
   verdict where it found it, and leaves self-ratifying forbidden.
5. M5 reverses this decision, as it reverses `D22`. `docs/v0-build-plan.md` installs the git gate
   hook there. What replaces this decision is M5's to settle, and the table below names what that
   is.

### Deferred, and what returns it

| Deferred | Returns when |
|---|---|
| Which record the gate hook here reads as the owner's verdict: a marker, as `README.md` and M5 promise a consumer, or the owner's merge | M5's decomposition is drafted, and the owner rules on it |
| Whether the hook can tell the owner's merge from a session's, given that sessions act through the owner's forge account and `R-GATE-3` bars the hook from taking an instruction | M5's decomposition is drafted, and the owner rules on it |
| Whether this repository ratifies the way Rigger ships to a consumer, so that Rigger still exercises its own L7 path on itself | M5's decomposition is drafted, and the owner rules on it |
| Who merges an owner-judged card once the hook is the gate, and what `AGENTS.md`'s "Review and merge" and the decision replacing `D22` say about it | M5's decomposition is drafted, and the owner rules on it |

### Notes

The owner stated on 2026-09-24 that merging a proposal's pull request ratifies it. That is how
#193, which added `D20`, and #194, #196, #199 and #200 were ratified. The owner merged each one,
and none carries a posted owner verdict (card #203).

The preambles described two events where the owner performs one. They had the owner ratify by
returning a sound verdict, and the entry bind once the pull request merged. A reader holding that
wording waits for a verdict nobody posts. On 2026-09-24 the M1 coordinator flagged `D20` as merged
with no verdict. It later relayed a needs revision onto #196 after the owner's merge had ratified
it. Under rule 2, a verdict returned after the owner's merge rules on nothing.

Rule 3 originally followed from `D19`; `D22` retains that permission only for cards without an
owner judge and without an authored binding edit. `R-GATE-4`'s evidence holds every configured
judge's verdict. Where the owner is one of those judges and the merge is the owner's verdict,
the evidence is complete only once the card has merged.

The whole arrangement ends at M5, and the owner ruled so on 2026-09-24, in the first round of the
pull request that proposed this decision. From M5 the hook reads verdict markers and nothing else,
and it binds every route to the main line, the owner's own merge included (`ARCHITECTURE.md`, "The
gate"). A merge cannot be a verdict that hook reads, so rules 1 to 3 cannot outlive it unexamined.
The deferred table names what M5 must settle, and this decision settles none of it.

The forge cannot tell the owner's merge from a session's. Sessions here act through the owner's
account, so rules 3 and 4 hold because sessions honour them, and nothing observes a breach.

This decision adds no requirement. It binds how the owner and the sessions working in this
repository ratify and merge, and `docs/spec/requirements.md` holds only what binds Rigger.

One signal ends this decision before M5. Where a merge recorded as the owner's proves to be a
session's, a merge alone is too weak a record of ratification, and the owner withdraws it.

## D22 — Binding edits need the owner's merge before M5

**Status:** Superseded by D25.

### Rule

1. Until M5, a maker merges its own card once `R-GATE-4`'s evidence is in hand, except when
   its kind names `owner` as a judge or its work changes an authored document in `AGENTS.md`'s
   "What binds" table. The maker never merges either card.
2. A card changing any authored document in that table must run under a kind that names `owner`
   among its judges. A card without that judge does not merge with the edit. Under `D21`, the
   owner merges the card after its agent judges are sound; that merge is the owner's verdict and
   ratification.
3. The maker's permission reaches the merge alone. Every verdict on which it rests comes from
   another role. This decision leaves self-ratifying and judging one's own work forbidden.
4. The permission reaches a card changing any path `AGENTS.md`'s "Self-hosting" section lists,
   subject to rules 1 and 2 when the card also changes an authored document in "What binds".
5. M5 reverses this decision. `docs/v0-build-plan.md` installs the git gate hook there, and
   what admits a merge thereafter is M5's to settle.

### Notes

`D19` gave a maker the merge after the configured judges were sound. A `type:change` card names
only a reviewer, so its maker could merge an edit to a binding document without the owner's
ratification. Rule 2 closes that route without changing how a card touching no authored binding
document is judged or merged. This decision supersedes `D19` because it narrows that decision's
permission, rather than adding within its scope.

The rule binds the sessions working in this repository until M5. A pull request's links
and labels can be changed by its maker, and no trusted receipt connects a pull request to its
card yet. The forge also sees sessions and the owner through the same account (`D21`). A
consumer check cannot prove this process rule from those facts, so the owner and the sessions
must honour it when choosing the card's kind and who merges.

This decision adds no requirement. It binds work in this repository rather than Rigger's
behaviour, which `docs/spec/requirements.md` alone records.

The cost is that an authored binding edit under a kind without `owner` must stop and return to
an owner-judged kind. That card incurs the configured judges and waits for the owner's merge.
M5 ends the interim process rule; a trusted gate record would replace the human check.
