ABOUTME: A journal entry from card #72: Four sentences said the build reds, and no check did

## 2026-09-22 — Four sentences said the build reds, and no check did

`D17` had to settle what a requirement no test claims does to the build. Four places said CI
reds on one, `AGENTS.md` said it of a requirement being added, and the draft of `D17` repeated
that red as though a check performed it. Running the matrix generator over a scratch copy of the
register showed none of them is mechanical.

Adding an unclaimed requirement and regenerating the matrix leaves every check at exit 0. So
does deleting the test that claimed a requirement: the staleness check reds once, a regenerated
matrix clears it, and the row goes quietly back to a gap. Editing a row's `checked by` moves
the matrix's mark and never the count, and retiring an unclaimed row moves both numbers down by
one with no test written.

Three of those four were claims the draft made in prose and would have shipped unmeasured. Each
took about a minute to measure, and two of them came back the opposite of what the prose said.
The rule that a decision's claims about a tool get run rather than reasoned about is cheap
enough that there is no excuse for the reasoned version.
