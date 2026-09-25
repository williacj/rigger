ABOUTME: Records card #218, L2's acceptance form check: why the first reader chased GitHub's
rendering, why that could not be finished, and the source-level rule the owner chose instead.

# 2026-09-24 — The card as it renders, and why the check reads source

The owner's U1 ruling names the form: the plain bullets under a heading named exactly
`Acceptance`. U2 names the refusal: every item matches the title after normalising. `R-CARD-8`
makes those two refusals the whole check. The check lives in `src/workflow/form-check.mjs`.

The first reader read the body line by line and then patched in pieces of Markdown so that no
qualifying card would be refused. It removed HTML comments, skipped fences, joined wrapped lines
and treated thematic breaks as special. The reviewer's first round then found six cards where the
reader disagreed with what GitHub displays: an indented code block, an unclosed comment, two
setext headings, a multi-paragraph item, and a comment opener inside a fence. Rendering more cases
through `gh api markdown` showed that the patched reader's own tests were wrong for some cards.
One case is a bullet indented four spaces after a one-line comment. The test counted it as a
bullet, but GitHub shows it as code.

That was the finding worth keeping. "As GitHub renders it" is the whole GFM block grammar, and
every patch moved the disagreement rather than closing it. The three ways out were a hand-written
parser, a Markdown dependency, or GitHub's renderer at admission. Each is a decision a maker does
not own, so the card went back as `ambiguous`.

The owner ruled that the form is defined on the source text, and the author rewrote #218 to a
precise line rule. The rule names fences, ATX headings, a section ending at a heading of the same
level or higher, and bullets indented at most three spaces. Everything else is not modelled: HTML
neither hides nor reveals a line, setext headings are not headings, and a line below a bullet
belongs to no item. The check is shorter for it, and any author can predict its answer by reading
the card's source.

One consequence of the rule is not in the acceptance. A thematic break written `- - -` or `* * *`
is a plain bullet under it, whose text normalises to nothing. So a section holding only such a
line is admitted when the title is not empty. The rule is the author's, so this is recorded here
and not changed in the code.

The punctuation step is still open for the owner. The check deletes every Unicode punctuation and
symbol character rather than turning it into a space, so `Support C` restates `Support C++`.

Run over the 150 issues `gh issue list --state all` returned on 2026-09-25, the source-level check
admitted 128 and refused 22, every refusal for missing acceptance. The refused are #211, the
decomposition record, and twenty-one issues numbered #24 or lower. Twelve of those head their
items `Acceptance criteria` and nine carry no acceptance heading at all, both of which U1 refuses.
