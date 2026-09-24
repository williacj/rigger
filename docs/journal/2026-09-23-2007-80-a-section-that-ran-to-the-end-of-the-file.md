ABOUTME: Card #80's finding: a test reading one section of a skill passed on text from another
section, and what the card's own figures measured at.

# 2026-09-23 — A section that ran to the end of the file

The test that reads the skill's fifth rule split the file on `###` and took the part starting
`5.`. No `###` heading follows rule 5, so that part ran to the last line of the file, and the
assertions about the rule were satisfied by the hand-off checklist below it. The test passed
while the rule said nothing about restating a source. Splitting on `##` as well bounded the
section, the same assertion redded, and the rule was written to earn it. A splitter that takes
one delimiter measures whatever the next delimiter fails to stop.

Every figure in the card had moved before the work started. It reported `D16`'s Notes at 339
words across six paragraphs and called them the longest in the register. Measured at the
branch's base, `D16` holds 191 words in four paragraphs, `D15` holds 227, and `D17` holds 696
across eleven — so `D16` is neither the longest nor second. The four sentences the card quoted
from `D16` are gone too, cut by `8115dcc`. The gap the card names survived all of it: nothing in
the skill asked whether a passage restated what it cited.

Two tools agreed on the figure before it was quoted. `countWords` and `wc -w` both returned 191
for `D16`'s Notes, and the extractor returned 34 for `D1`, which is the one figure in the card
that could be checked against a number someone else had measured.
