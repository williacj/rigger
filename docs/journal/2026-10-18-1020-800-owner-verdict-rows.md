<!-- ABOUTME: Records the proposal of R-VERDICT-8 to R-VERDICT-13, the owner's verdict verb, and the two forms its judges returned it for. -->

# The owner's verdict verb, as rows

M6-21 proposes `R-VERDICT-8` to `R-VERDICT-13` and their two dimensions tables, from U6 and U7. The draft came from card #800 at acceptance revision `fa6b55109bd5`.

The judges of round 1 returned two faults of form that no lint catches. First, the draft's `R-VERDICT-11` named `R-VERDICT-10`'s table as its edges. The preamble ties a dimensions table to the row whose id heads it, so `R-VERDICT-11` now states its own bound: a process under a dispatch that opens a terminal of its own lies outside it. Second, several out-of-scope cells retold what `D25` rule 2, `R-GATE-7` and `ARCHITECTURE.md`'s "The gate" own. Each now cites its source and keeps its scope.

Two judges also ruled the rows critical for landing with no claiming test. The owner's U10 settled that a spec card may land its rows as gaps once it names the card that claims them (`D17` rule 6.1). That card is M6-24 (#803).

`npm run check:references` reads no `docs/v0-build-plan.md`, because `doc-references.json` does not name it. The build plan's one-line edit is read by hand.
