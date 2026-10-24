ABOUTME: Records card 920's proposal that withdraws R-FAIL-6 for R-FAIL-7, classing a judge's scratch directory not made.

# Card 920: R-FAIL-7 classes a judge's scratch directory not made

[#920](https://github.com/williacj/rigger/issues/920) proposes the delta
[U43 and U44](https://github.com/williacj/rigger/issues/740#issuecomment-6377288414) rule on.
`R-FAIL-6`'s table classed a judge's scratch directory refused under `R-WORK-26`, but not one the
file system failed to make. The architect's third recheck of #871 found the gap (finding 8).

U43 classes the cell `out`, with the outcome of a judge's directory not made. It takes a row of
its own, directly below that one. The register's preamble decides the id: the edit moves a cell
into scope, so the row takes `R-FAIL-7`, and `R-FAIL-6` moves with its table unchanged to the
retired register. The 16 test claims of `R-FAIL-6` retarget under the card's grant class G1.

The first draft widened the judge row to hold all three causes. All three judges found that this
breaks spec-style rule 4, which the lint does not check, and the card's author revised the
acceptance to add the row instead.

What taught us: a green `lint:spec-style` covers rules 1 and 2 only. A draft delta that joins a
third condition to a table cell needs rule 4 read by hand before the card is dispatched.
