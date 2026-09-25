ABOUTME: Records card #271, which has L2 read the epic label from the consumer's config and the
validator refuse an epic label that is no name or that some kind selects.

# 2026-09-25 — The epic label comes from the config

Before this card L2 kept `R-SCHED-11` only while no kind selected `type:epic`. A card labelled
`type:epic` and `type:change` was selected by `change` and dispatched. L2 now takes the declared
label as a third argument to `nextAction`, and a card carrying it is selected by no kind. So it is
ignored rather than dispatched, and rather than refused when it also carries two kinds' labels.

The argument is optional, so the existing next-action tests pass without an edit. Absent, it
marks no card an epic, which is how #270 reads an absent `epicLabel`.

The validator refuses an `epicLabel` that some kind selects, following the item the PM added on
2026-09-25. Without that refusal a kind selecting the epic label would have every card it selects
ignored, and nothing would tell the consumer why.

Two mutations, each guarded and restored, show what the L2 tests hold. Removing the epic rule reds
the dual-label, two-kinds and `kind:epic` tests. Hard-coding `'type:epic'` in place of the
declared label reds the `kind:epic` and absence tests.
