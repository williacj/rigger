<!-- ABOUTME: Records what card #712 learned while landing the ratified P39 structure delta and D24. -->

# Landing a ratified delta word for word

The delta's twelve edits named a location for each change. Two of them did not match the document
exactly. Edit 7 said "first paragraph" of "The gate", but "L4 names the judges" sits in that
section's second paragraph. Edit 3's "Read by" addition had to join a list that ended "the loop and
the gate", so the join became a comma list. Neither changed a word the owner ratified.

The spec-style lint refused one sentence of `D24`'s "Reversed by", at 42 words. It was split at its
semicolon into two sentences; only the capital on "Either" changed. A delta drafted in the scratchpad never met the
lint, so the next one should be run through it before it goes to the owner.

The path check refused `D24`'s two backticked mentions of `.rigger/`, because `docs/spec/` is
checked strictly and no such path is tracked. Both now say "the state directory", the name
`ARCHITECTURE.md` gives `.rigger/` in its Engine settings row. The meaning is unchanged.

Edit 5 could not land here. `test/config.test.mjs` holds the validator's offered keys equal to the
published config shape, so publishing `providerLabels` before `SHAPES.role` offers it reds the
suite. This repository pairs the two in one card, as #477 did for `labels` and `timeout`. Edit 5
moved to #714 with the validator change (C24). The architect's card plan should have seen that
pairing before it put the structure card first.
