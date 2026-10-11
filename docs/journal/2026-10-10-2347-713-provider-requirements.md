<!-- ABOUTME: Records what card #713 learned while landing the judge-provider requirement rows. -->

# The judge-provider rows, and a backticked event name

The card's first wording of `R-VERDICT-7` put `marker.read` in backticks in its `checked by` cell.
`check:paths` read the backticked `marker.read` as a file path, so it refused
the row with "no such path `marker.read`". The card's author reworded the cell to name the event
without backticks, and the four rows then landed word for word. An event name in a register cell
is written bare, as the other `the event record, by ...` cells already are.

`R-GATE-8` changed only its closing period to a semicolon, so `R-GATE-9` can end `R-GATE-4`'s list.
The four new rows show as gaps in the test matrix until P39-C claims each with a test.
