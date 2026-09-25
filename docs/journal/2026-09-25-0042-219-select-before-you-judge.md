ABOUTME: Records card #219, L2's next action for a ready card: why kind selection runs before the
form check, and the one reading of a kind's `select.labels` the card left open.

# 2026-09-25 — Select before you judge

`nextAction` in `src/workflow/next-action.mjs` answers ignore, refuse or dispatch for a ready card.
The order of its three questions matters, and the card's acceptance fixes it: both selection checks
come before the form check.

Selection comes first because `R-SCHED-11` says a card no kind selects is never reported as
refused. If the form check ran first, a card outside Rigger's remit with no acceptance, such as an
epic or a note someone left in Ready, would come back as a refusal. The consumer did not ask
Rigger to judge that card, so it has no business naming it. The card's fourth item pins this
down: running the form check first breaks it.

A card two kinds select is refused before the form check runs. The owner's U15 ruling makes it a
refusal that names both kinds, and the card's sixth item requires that reason for every such
card, so a two-kind card with no acceptance must still get it. Running the form check first
breaks that item too, and the item's test uses a body the form check refuses so that it shows.
It is a refusal about selection, not about form, which is why ruling 6 keeps it outside
`R-CARD-8`'s two form reasons. The kinds are named in the config's order, so the reason stays the
same whatever order the card's labels arrive in.

The first round of review found both orderings unpinned or misdescribed. I had written that the
acceptance left the two-kind order open, when item 6 fixes it. The lesson is to read each item
for the orderings it implies, not only for the outcome it names.

One reading was left open. The architecture calls `select.labels` "the card labels that select the
kind" and does not say whether a kind needs all of them or any one of them. This repository's
config names one label per kind, so the two readings agree on every card it has. The code takes
any one, because each label is described as one that selects. The pull request raises this for
the owner rather than settling it in a test.
