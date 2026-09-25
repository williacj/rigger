ABOUTME: Records card #218, L2's acceptance form check, and the reading choices the owner's U1
and U2 rulings left to the maker.

# 2026-09-24 — The card as it renders

The owner's U1 ruling names the form: the plain bullets under a heading named exactly
`Acceptance`, at any level, up to the next heading. U2 names the refusal: every item matches the
title after normalising case, whitespace, the list marker and punctuation. `R-CARD-8` makes those
two refusals the whole check. The check lives in `src/workflow/form-check.mjs`.

The card's item 11 is what pushed the parser past a line split. It says any card holding one
plain bullet that does not restate the title is not refused. A naive reader breaks that promise
in ways a card author would never see, because they are about Markdown the card does not show.
A `#` comment inside a fenced shell block reads as a heading and closes the section early. A
heading inside an HTML comment does the same. A CRLF body leaves a carriage return on every
heading line, so `Acceptance` never matches. So the check reads a body the way it renders:
comments are removed, fenced blocks are skipped, and closing heading hashes are allowed.

Two choices sit inside U2's wording rather than beside it. The first is that an item is its
bullet line together with the lines it wraps onto. Read as its first line alone, the item
"Add a verb" wrapped onto "that prints its help" would match a title of "Add a verb". A
qualifying card would then be refused, which item 11 forbids. A numbered item, a task-list item,
a heading and a blank line each end an item.

The second is what counts as punctuation. The check takes out every Unicode punctuation and
symbol character, and deletes it rather than turning it into a space. Symbols are included
because Markdown's backtick is a symbol in Unicode's classes, and a title like "Add the `plan`
verb" should match an item that drops the backticks. Deleting rather than spacing is a judgment:
neither reading is stated in the ruling, and deleting is the literal meaning of taking
punctuation out.

A thematic break such as `* * *` has the shape of a bullet. It is not an item, because a card
whose `Acceptance` section held only a rule would otherwise be admitted with no acceptance.

What the check does not read is setext headings, the underlined `Acceptance` followed by `===`.
None of this repository's 149 issues uses one, measured on 2026-09-24 over the bodies
`gh issue list --state all` returned. Supporting them needs paragraph tracking, which is more
machinery than today's cards call for.

The same 149 bodies, run through the check that day, gave 127 admitted and 22 refused, every
refusal for missing acceptance and none for a restated title. The refused are #211, the
decomposition record, and twenty-one issues numbered #24 or lower. Twelve of those head their
items `Acceptance criteria` and nine carry no acceptance heading at all. U1 refuses both on
purpose.
