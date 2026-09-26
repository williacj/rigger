ABOUTME: Records card #289, which has the forge adapter report what else a board holds, `doctor`
fail on it and `setup-board` refuse before its first write.

# 2026-09-25 — A board shared with another repository

The read side gains `readOtherRepositories`, its own paginated read of the board's items. It
selects each item's `type` and the repository of an issue or pull request, and nothing else.
`readItems` is left alone: its document is pinned byte for byte to board 6's capture, and the
two answer different questions. The cost is a second item read on `doctor` and `setup-board`.
That is a judgment, not a measurement.

Both reads decide whether an item is the repository's by `ofRepository`, one function in
`src/substrate/forge/read.mjs`. The architect's cut asked for the comparison to be imported by
both. Both callers live in that one module, so they call it directly and nothing imports it.

A redacted item counts as unreadable, which fails the line. The fake `gh` answers one with
`type: REDACTED` and null content. That shape is constructed from the schema, and no real board
has shown one. The report reads `type`, so a later finding that GitHub answers the content
differently does not change the verdict.

`doctor` prints the line only when the config earns no refusals, so a refused config sends no
board request. The line names the other repositories and never `repo`, which is what lets the
exact-set test catch the mutation that drops the comparison. `setup-board` refuses in the same
words, taken from `sharedWith` in `src/cli/doctor.mjs`, before it plans a single write.

The existing `doctor` tests hand every board read an empty page, so their verdicts stay fixed.
The wiring test's stand-in `gh` answers the board read with sign-in text. The line then fails,
and the test reads the status off the report as before.
