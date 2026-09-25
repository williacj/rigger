ABOUTME: Records card #240, the PM's proposal of M1's register changes: why the acceptance form
became a requirement rather than a D2 amendment, and how a row carries questions it cannot settle.

# 2026-09-25 — A row that cannot wait for its questions

Card #240 proposes `R-CARD-12`, the acceptance form on the body's source text, and `R-SCHED-12`,
the refusal of a card two kinds select. It also moves `R-SCHED-1`'s `checked by` to the test
suite. The rows travel in the pull request until the owner merges it (`D21`).

The acceptance form went into the requirements register, not into `D2`. `D2` records the choice
to keep the acceptance in the issue body. What counts as an item is observable from outside, so
it is a requirement, and the owner's U1 ruling said it needs one to bind.

Six owner questions touch these rows, and none of them is mine to settle. A row has to be
written one way or the other, though, so each row carries the reading #218 and #219 built. The
pull request names each question at the clause it bears on, so the owner's answer lands on a
named phrase before ratifying rather than after.

`R-SCHED-1`'s `checked by` changes before any test claims it: #221 is still open at this base.
The matrix therefore shows it as a gap rather than `nothing yet`. `D17` rule 4 says the edit
moves no requirement into or out of the counted set, and `R-SCHED-1` was in that set already.

The card asked for one test that fails under two mutations. No #218 test does, so each mutation
reds a different declaring test. The pull request says so, rather than adding a test body a
`spec` card has no business writing.
