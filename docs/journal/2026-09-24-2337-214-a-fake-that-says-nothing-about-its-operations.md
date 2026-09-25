ABOUTME: Records card #214, which built the test-only fake board M1's scheduling behaviours are
proven against, and why it ended with no sample calls on its operations.

# 2026-09-24 — A fake that says nothing about its operations

The fake board lives in `test/fake-board.mjs` and nowhere under `src/`. Its operations are the
set the forge adapter must equal (#216). The set was kept to the four reads and four writes this
card's acceptance needed: `readItems`, `readColumns`, `readFields` and `readLabels`, then
`moveItem`, `createColumn`, `createField` and `createLabel`.

The first round gave every operation a sample call. The boundary test (#213) was to find writes
by calling each operation and watching the write record, and to find column changes by watching
the board. The fake's own tests named any operation with no sample call, and any write whose
sample changed nothing a read returned. That second check caught a real gap: `createLabel`
recorded its write and changed nothing a read could see, so the board gained its labels and
`readLabels`.

The reviewer then showed that the mechanism still leaked, by two routes its tests could not
close.

- **A write could skip the record.** An operation that changed the board and never recorded
  itself was classed as a read, so no write check ever reached it.
- **A column change could hide behind its sample.** On GitHub a column move is a write to the
  `Status` field. A generic field write sampled on `Priority` changes a field value and no
  column, so nothing would count it as the column change it can be.

Both leaks share a root. The sample calls asked the fake what an operation does, and the fake can
only answer for the one call it is shown. The owner ratified Delta G (#247) in its place. The
boundary is held by which bindings a module imports, and the adapter's runners refuse any request
outside their side. That has no reader for a sample call, so the acceptance was revised to
withdraw them, and they were deleted.

A card is moved by its board item id, which the fake assigns as `item-1`, `item-2` and so on in
the order the fixture gives. A draft issue has no number, and another repository's issue can
share one, so an issue number could not have named the item.

Items were at first passed through whole, so a fixture could have handed the fake a card's
linked pull request and the fake would have kept it. Ruling 1's B3 and B4 put both that and a
verdict off the board. The item's facts are now an explicit list, and anything else is refused
by name. A pull request that sits on the board as an item is still held, with its type.

A held read answers with the board as it stands when the test releases it, not as it stood when
the read was made. That lets a scheduler test place a write before or after the answer, which is
the ordering a claim-before-await proof needs. Only one read can be held at a time, so a test
cannot yet hold two reads that the code under test starts together.

Worktrees this harness creates had no `core.hooksPath`, so the first two commits here were made
without the gate running. The coordinator caught it on another card. The hook was switched on
before the third commit, and the first two were checked on a fresh clone before the pull request
opened.
