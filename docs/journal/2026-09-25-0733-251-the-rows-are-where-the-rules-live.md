ABOUTME: Records card #251, which moved the spec-style lint from prose into table cells, and the one
cell on main it escalated to the owner instead of restyling.

# 2026-09-25 — The rows are where the rules live

The lint skipped table rows on purpose. Its reasoning was that a list or a table is rule 4's
answer to a structure prose carries badly, so measuring one as a sentence would punish a document
for doing what the register asks. That argument holds for a list of short items. It does not
hold for a register, where the row is the only place a requirement or decision can be written.
So the ceiling was never applied to the text it exists to govern. PR #250's 318-word `R-CARD-12`
cell passed the lint and three judges, and only the owner's own reading caught it.

The change reads each cell with the same splitter as prose, so a cell carries the same disclosed
bias. That bias is a merge on a lowercase word after a stop, and a split on an abbreviation
before a capital. A row is one line, so a cell needs no rule of its own for line breaks. The one
new bias is that an escaped pipe splits a cell where markdown would not. That can only lower a
count, and the linted documents hold no escaped pipe (`grep -F '\|'` over the four documents
at `f44ca18`: no hits). A `<br` appears only inside `ARCHITECTURE.md`'s mermaid fence, which
the lint never reads.

Measured on `main` at `f44ca18` with the extended splitter, the lint raised one cell finding.
It is `ARCHITECTURE.md` line 36, the **L2 Workflow** row's "Decides" cell. That cell is one
50-word sentence of semicolon-joined clauses with no full stop. The card forbids the maker from
restyling a ratified row, so the maker escalated it. To keep `main` green meanwhile, the first
push held the finding in an exemption list the lint printed on every run. The owner ruled that
the row be restyled first, on #257, and the hold list dropped rather than kept as a mechanism.
Once #257 merged, the lint read all four documents with no finding and nothing excused.

What taught us: a check that excludes something "by design" should say what the exclusion costs
in the documents it guards, not only why the exclusion is principled. Here the cost was the
entire register.
