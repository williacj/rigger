ABOUTME: Records card #253, the PM's proposal bringing R-CARD-12's rows and the R-SCHED group into
line with the owner's rulings of 2026-09-25: which rows kept their ids, and what round 2 changed.

# 2026-09-25 — The rows say what the code does

The card asked the register to state rulings #252 had already built. The id test in the
requirements preamble decided the shape. It asks whether an edit changes what must be true of
Rigger. Ruling (e) did: `R-CARD-16` said a closer "holds only a run", so a closer with trailing
spaces left the fence open. That row is withdrawn and `R-CARD-26` replaces it.

In round 1 I kept `R-CARD-15`'s id, arguing that the ratified rows left nested fences undetermined.
The reviewer showed the literal rows did settle one such body, and the owner ruled the row retired
for a new id, `R-CARD-35`. The lesson: where a literal reading of the ratified text decides a body
differently, the id goes, however much the reading looks like an oversight.

The judges' blocking findings were both about words the rows used without owning them. "Space"
sat beside a whitespace list holding U+00A0, and "marker" already names the verdict marker. Round
2 defines a space as U+0020 and a list marker as `-`, `*` or `+`. It also renames the line
`R-CARD-23` describes a list line, so no row says "an item … is never an item". An item is now
whatever list line no exclusion row reaches. `R-CARD-23` and `R-CARD-24` keep their ids under the
preamble's test, because the set of items is unchanged. `R-CARD-25` split into two rows, and the
preamble's splitting rule gives each part a new id.

Round 1 found the code wider than ruling (c), and #265 then narrowed the code to the ruling. So
`R-CARD-29` now states the ruling: each HTML comment ends at its first `-->`.

A `spec` card wrote six test bodies across the two rounds. Each pins a clause nothing else held:
- the nested fence opener;
- a comment closed on a later line;
- the no-break space as whitespace and as no space;
- the order of deletion and collapse;
- the full case mapping with final sigma.

Each passed on arrival, since the code already behaved so. The mutations are what show each one
discriminates.
