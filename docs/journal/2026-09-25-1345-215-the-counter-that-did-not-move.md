ABOUTME: Records card #215, which gave the forge adapter's read side the board's cards, columns,
fields and labels, and what reading board 6 showed about measuring what a read costs.

# 2026-09-25 — The counter that did not move

#216 left the read side holding only what its writes needed. This card gave it the four reads the
fake board offers, `readItems`, `readColumns`, `readFields` and `readLabels`. Each one is a GraphQL
query sent through the read runner. So the adapter's operations and the fake's now match by name,
in both directions, with `createColumn` the one exception until #217 lands.

**A card is read whole or not at all.** The item query reads one page of each item's labels and
field values. If a card held more than a page of either, the read would return it short. A card
with a missing label, or a missing column, looks exactly like a whole card. So the read fails and
names the issue. The same holds a level up: a page of items that fails fails the whole read, and
no partial board is returned.

**The column is looked up by the field's name.** Each item's single-select values arrive with the
field each belongs to. The read takes the one whose field is `Status`. It never takes the first
value, because a board can hold a second field with the same option names. Board 6's #20 holds a
value in all five of its single-select fields.

**`readColumns` answers the config's keys.** The architect's ruling has L0 map display names to
column keys, and the card asks for two configs that name different display names to read into the
same five keys. So `readColumns` answers `{ ready: …, owner: … }`, and only after checking that
each name is a `Status` option. The fake's `readColumns` answers the board's option list instead.
The two share a name and differ in shape, which #223's fake `gh` will have to reconcile.

**The measurement the card asked for measured nothing.** On 2026-09-25, `gh api rate_limit`
reported the same GraphQL count before and after two full reads of board 6. For both reads,
`used` stayed at 1 and the reset time at 14:06 UTC. GraphQL's own `rateLimit` field ran on a
different window, reset at 14:21 UTC, and moved by 10 across the second read. That 10 also
counts the `rateLimit` query itself and anything else that used the token in the same seconds. Asked with
`dryRun: true`, GitHub priced the read's three query shapes at 2, 1 and 1 points. A full read
sends the field query twice, so it costs 5 points. A figure of 0 would have met the item as
written and told the owner something false. So the PR states all three figures, and the
measurement method went back to the card's author. The author revised the item to ask for the
cost GitHub reports for each query, summed.

**A page boundary is not a snapshot.** Items are paged by cursor while the board can change
between requests, so the same item can come back on two pages. The first round simply
concatenated the pages. A judge's probe, with one item on both pages, got 102 cards back where
101 were unique. The read now keeps each item where it first appeared.

**"Recorded" meant two things to two judges.** One judge read it as shaped like `gh`'s answer,
the other as captured from `gh`. The author ruled for the first reading, and bound it to a
checkable shape: only the fields the query selects, nested as `gh` returns them. The test forge
now checks every answer it constructs against the key paths `gh` printed for the same query on
board 6. That makes the shape a check the suite runs, not a claim the reviewer has to take on
trust.
