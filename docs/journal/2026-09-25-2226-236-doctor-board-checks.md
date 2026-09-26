ABOUTME: Records card #236, which has `rigger doctor` check that the configured board can be read,
holds each declared column, and holds the declared priority field.

# 2026-09-25 — `doctor` checks the board

`doctor` gains a set of board lines, reported after config validity and before board sharing:

- `board reachability`;
- one `board column <key>` line for each declared column;
- `board priority`.

Every line reads through the forge adapter's read side, so a failed read carries the adapter's
message. That message names the board, the owner the request addressed, and `gh`'s first line.
`doctor` never works out the board's owner itself.

Each column line is the adapter's own column read, sent with the config narrowed to that one
column. So the failure is the adapter's words, naming the key and display name, and one missing
column fails only its own line. The cost is one field read per column. That is a judgment, not a
measurement.

The priority line reads fields and never cards. It finds the field and its type in the typed
field listing, then compares the field's option names with the declared ones as sets. A
single-select field's options come from `readFields`. For `Status`, which `readFields` leaves out,
they come from `boardOf`, the read `setup-board` takes the column options from.

It took three rounds to get there:

1. **Round 0.** The first version read every option from `readFields`. Both judges on round 1
   found the flaw: the validator accepts `Status` as the priority field, and `readFields` leaves
   `Status` out. So a board whose `Status` options matched failed the line, with a `TypeError`'s
   words.
2. **Round 1.** The fix read the options through `readPriority`, which finds any field, but it
   also reads every card. Codex on round 2 showed the flaw. One card holding more than 100
   labels, which the read side refuses, failed the line whether or not the options matched, and
   hid the options that differed.
3. **Round 2.** The line no longer reads cards at all.

The lesson is that a check about one thing reads only that thing. Borrowing a wider read brings its
failure modes along with it.

Merging #185 brought a case the board lines had not met: validation that throws, as a BigInt
config does. `boardChecks` now says the board was not checked because the config could not be
validated, and #185's test counts that line.

A config the validator refuses, or cannot read, earns one `board checks` line saying the board
was not checked. No request is sent. The board-sharing check still prints nothing in that case,
as #289 left it.

The fake `gh` can now hold its board under a declared owner. Without that, a request addressing
the declared owner could only fail. With it, the owner tests show the reachability line passing
on the one board the fake holds.

The existing `doctor` tests answered every board read with an empty item page. They now answer a
field read with the starter config's columns and priority field, so every board line passes
wherever a test fixes the other verdicts.
