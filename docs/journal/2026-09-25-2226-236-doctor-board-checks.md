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

The priority line reads the field types first, so a missing field and a field of another type
each fail in words of their own. Only then does it read the options, which it compares as sets.
It does not call `readPriority`, because that reads every card too. A card the read side refuses,
such as one holding more than 100 labels, would fail the priority line for a reason that has
nothing to do with the field.

A config the validator refuses, or cannot read, earns one `board checks` line saying the board
was not checked. No request is sent. The board-sharing check still prints nothing in that case,
as #289 left it.

The fake `gh` can now hold its board under a declared owner. Without that, a request addressing
the declared owner could only fail. With it, the owner tests show the reachability line passing
on the one board the fake holds.

The existing `doctor` tests answered every board read with an empty item page. They now answer a
field read with the starter config's columns and priority field, so every board line passes
wherever a test fixes the other verdicts.
