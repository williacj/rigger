ABOUTME: Records card #214, which built the test-only fake board M1's scheduling behaviours are
proven against, and why a write on it must show in what a read returns.

# 2026-09-24 — A fake that cannot hide a write

The fake board lives in `test/fake-board.mjs` and nowhere under `src/`. Its operations are the
set the forge adapter must equal (#216), and the boundary test (#213) finds writes and column
changes by calling each one. So the operation set is an interface other cards build on, and it
was kept to the four reads and four writes this card's acceptance needed: `readItems`,
`readColumns`, `readFields` and `readLabels`, then `moveItem`, `createColumn`, `createField` and
`createLabel`.

The sample calls are plain argument lists keyed by operation name, all valid on one fresh
`sampleBoard()`. A test holding a list of names would miss an operation added later, which is
what review R5-B1 found. So the fake's own test reads the names off the board object, and it
names any operation that has no sample call.

That test earned its place before the card was done. The first `createLabel` recorded its write
and changed nothing any read could see. The check that a write's sample call must change what
a read returns named it at once, and the board gained the repository's labels and `readLabels`.
Rule 5 of the boundary test would otherwise have seen a write it could not tell apart from a
no-op.

A card is moved by its board item id, which the fake assigns as `item-1`, `item-2` and so on in
the order the fixture gives. A draft issue has no number, and another repository's issue can
share one, so an issue number could not have named the item.

Items were at first passed through whole, so a fixture could have handed the fake a card's
linked pull request and the fake would have kept it. Ruling 1's B3 and B4 put both that and a
verdict off the board. The item's facts are now an explicit list, and anything else is refused
by name. A pull request that sits on the board as an item is still held, with its type.

A held read answers with the board as it stands when the test releases it, not as it stood when
the read was made. That lets a scheduler test place a write before or after the answer, which is
the ordering a claim-before-await proof needs.

Worktrees this harness creates had no `core.hooksPath`, so the first two commits here were made
without the gate running. The coordinator caught it on another card. The hook was switched on
before the third commit, which it ran green, and the first two were checked on a fresh clone
before the pull request opened.
