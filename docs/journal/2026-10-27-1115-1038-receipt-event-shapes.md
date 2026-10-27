ABOUTME: Records how card #1038 made mutation:receipt and proof:diff tell a named test from a
file's own verdict on Node v26.5.0, whose test events carry no entryFile, and how the streams were recorded.

# The receipt reads two event shapes

Node v26.12.1 marks each named test's events with an `entryFile` and leaves the file's own events
unmarked. Node v26.5.0, which `engines` admits, marks none. The receipt booked every unmarked
test as a file verdict, so on v26.5.0 every run answered "no verdict" and `proof:diff` could pair
no test (#1038, and its reproduction comment).

The file's own event on v26.5.0 shares `testId`, `parentId`, `nesting` and `file` with the file's
first test, so none of those can tell them apart, and a test titled after the file's basename rules
out a basename check. What differs is where Node places the file's event. Node names it for the file
operand, and puts it at line 1, column 1 of that file. `parseEvents` in
`scripts/mutation-receipt.mjs` books an unmarked event placed so as the file's verdict, and every
other test event as a named test. With no `entryFile`, a named test's entry is the one file the run
was given, which keeps `proof:diff`'s identity, and its pairing, unchanged. `proof:diff` needed no
edit.

The streams under `test/fixtures/receipt-events/` were recorded from `subject.mjs` beside them. A
`RIGGER_RECEIPT_EVENTS` shape picks what each run shows; unset, every test passes, so the
deterministic suite runs the subject green. Each stream is the unedited output, at the worktree
root on the Node its name gives, of the command `test/receipt-events.test.mjs` quotes. The output
is piped through `sed` and `jq -s .`, so the fixture is JSON, which the header rule exempts. The
suite's exit status is not in the stream, so the test states each one as the recording observed it.

The streams were recorded with the extraction commit's reporter, which this card does not change.
So the red is shown by copying only the head's test file onto that commit. One v26.5.0 row stays
green there: a file that fails to load was already a file verdict at `f6c663b5`. It guards the
fix against booking such a file as a named kill.
