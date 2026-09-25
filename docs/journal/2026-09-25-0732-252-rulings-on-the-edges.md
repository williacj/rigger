ABOUTME: Records card #252, which brought the form check and kind selection into line with the
owner's rulings of 2026-09-25 on the edge cases #218 and #240 had left open.

# 2026-09-25 — Rulings on the edges

Three rulings changed what the form check reads as an item, and all three follow one rule: a line
that says nothing to a judge should not stand as a card's acceptance. A bullet holding only HTML
comments (`- <!-- fill in -->`) is a placeholder. `- - -` is a thematic break that happens to
start with a bullet marker. A fence closer with trailing whitespace looks closed to the author,
so leaving the fence open hid every bullet below it. The first two now refuse cards that used to
pass. The third admits cards that used to be refused.

The any-one reading of a kind's `select.labels` was already how #219 built it. What was missing
was a guard. Every kind this repository declares names one label, and with one label "any" and
"all" give the same answer, so no existing test could tell them apart. The new test uses a
two-label kind, which is the smallest fixture where the two readings differ. An empty label list
is where "any" goes badly wrong: the kind can never select a card, so its work would never run
and nothing would say so. The validator now refuses that config.

Two tests close gaps #240's maker found in the line-reading clauses. The lone-CR test needed a
body where splitting would change the verdict. The existing stray-CR test does not qualify:
splitting there leaves an empty line and the verdict stays the same. The body
`## Acceptance\r- item` does qualify, because a split gives it a section and no split leaves it
with none. The leading-space test uses `-  [ ] item`. Its text starts with a space, so it is no
task-list item, and trimming the text would turn it into one. Each rule is the only thing that
decides its test, and a mutation to either one reds it.

These tests carry no `// proves` line. The rows they prove are in PR #250 and are not yet on
`main`, so card #253 adds the lines once that PR lands.
