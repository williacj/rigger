ABOUTME: Records card #257, the form-only split of ARCHITECTURE.md's L2 Decides cell into two
sentences under the spec-style ceiling, and why the split falls where it does.

# 2026-09-25 — Where the semicolons already split

Card #257 restyles one cell: the L2 Workflow row's "Decides" in `ARCHITECTURE.md`. At `63c79ed`
it was one 50-word sentence, the only finding PR #256's table-cell lint raises on `main`.

The cell already had two halves. The first clause names the next action and qualifies it with an
"including" phrase. The rest is a semicolon list of five things L2 also decides. The only full
stop goes where that qualifier ends, so "including" keeps its scope on the next action alone and
no clause moves.

The second sentence keeps its semicolons rather than becoming five one-phrase sentences. That
keeps the change to one full stop, one capital and a closing full stop. It also matches the
neighbouring "Never decides" cells, which list with semicolons. The closing full stop follows the
L0 row, whose multi-sentence cells end with one.

Measured with PR #256's `sentences()` and `countWords()`, taken from `m1/251-lint-table-cells`
at `5585321`: the two sentences are 27 and 23 words. That lint's `check()` with no hold finds
nothing in the four documents it reads at this head.
