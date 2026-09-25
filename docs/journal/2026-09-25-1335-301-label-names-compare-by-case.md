ABOUTME: Records card #301, which has Rigger compare label names as GitHub does, whatever their
ASCII letter case, and why the one comparison lives in the config module.

# 2026-09-25 — label names compare whatever their letter case

GitHub answered a lookup of `TYPE:EPIC` with the label `type:epic` (#301's measurement, on PR
#299), so it holds label names case-insensitively. Rigger compared them exactly in four places:
the validator's check of `epicLabel` against a kind's labels, L2's kind selection, L2's epic
check, and `setup-board`'s create-or-adopt with the `declaredLabels` it reads.

**One comparison, `sameLabel`, in `src/config/validate.mjs`.** It folds ASCII `A`–`Z` only,
because the measurement covers nothing wider, and `toLowerCase` would also fold non-ASCII
letters the card leaves unfixed. It sits beside `selectedLabels` and `declaredLabels`, which
already read the config's label names. `next-action.mjs` imports it from there, a new edge
from `src/workflow/` to `src/config/`. No boundary rule bars that edge, and `layer-boundaries`
reports nothing. Putting it on L0's read side would have had the validator load the runners to
compare two strings.

**`declaredLabels` keeps the first spelling declared.** Where kinds select both `bug` and `Bug`,
`setup-board` creates one label, spelled as the config declares it first. A label Rigger creates
keeps the config's spelling, and a held label is adopted as GitHub spells it.

**The fake `gh` still holds labels exactly.** It accepts a create that differs from a held
label only in case, so the tests read the write record, not a refusal from the fake. Whether
GitHub refuses such a create is the reviewer's judgement on #299, and nobody has measured it.
