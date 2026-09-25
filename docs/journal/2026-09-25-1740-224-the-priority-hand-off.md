ABOUTME: Records card #224, which gave L0's read side the priority hand-off L3 ranks by, and why
the read asks for every field's type rather than reusing the single-select field read.

# 2026-09-25 — The priority hand-off

`readPriority` in `src/substrate/forge/read.mjs` hands L3 what #221's `pullOrder` already took.
Each card carries `priority: { value, declared }`, and beside the cards sit `declared`, the config's
order, and `options`, the field's own options in board order. L3 reads `items` and `declared` and
ignores `options`, which is there for a reader such as `doctor` that compares the two.

**The read asks for every field with its type.** The single-select field read answers any other
field as an empty object, so it cannot tell a declared field that is missing from one of the wrong
type. The card needs both errors, and the second must name the type. So the priority read has a
query of its own, with `... on ProjectV2FieldCommon { name dataType }` beside the options. Board 6
answered it once, at 17:27 UTC with gh 2.99.0, after the card's comment named the command. That
capture lists 17 fields and their types, `MILESTONE` among them (counted with `node` over the
committed fixture). The type-error test declares
Milestone as the priority field against that capture, so the double's answer is gh's own.

**With no declaration, a card's `priority` is null, not `{ value: null, declared: false }`.** The
card says L0 hands "no priority value". #221's stand-in handed a value object with a null value
instead. That hid #294's N1: a guard in L3 that reads a value when no order is declared passed
every test. Now that such a guard throws, the two tests of the undeclared case fail on it, in
`pull-order` and in the fake `gh` composition. The mutation run that showed this is in the PR.

**The fake board gained `readPriority` because a test requires it.** `forge-adapter.test.mjs`
requires every adapter operation to have one on the fake board. The fake's version takes the
declaration as an argument, since the fake holds forge facts and no config. It replaces #221's
`handOff` stand-in, so the ranking logic has one copy under `test/`. A test through the fake `gh`
also checks that copy against the real adapter's output.

**The board-owner test found the new operation.** `forge-board-owner.test.mjs` lists every
operation that finds a board, and it went red until `readPriority` was added to its rows. So
`R-WORK-7`'s tests now cover the priority read too.
