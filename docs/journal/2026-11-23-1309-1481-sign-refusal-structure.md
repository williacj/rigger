<!-- ABOUTME: Records #1481's ARCHITECTURE.md delta placing the structure for R-STATE-30 to R-STATE-39: where each sign of an earlier dispatch's process is kept, the one refusal point, and the stop on a sign. -->
# #1481: where Rigger keeps a sign and refuses a dispatch

## What landed

"Failure model" gains "Signs of an earlier dispatch's process", and "Telemetry" gains "L3's stop on a sign". They place the structure for the rows #1478 adds, `R-STATE-30` to `R-STATE-39`. The owner ratified those rows' positions in [M8-U104](https://github.com/williacj/rigger/issues/1293#issuecomment-7110158253) and [M8-U105](https://github.com/williacj/rigger/issues/1293#issuecomment-7110633947).

## The contradiction it resolves

"Failure model" had L0 record a process it could not end "and settle", then said a dispatch "ends only once L0 has terminated the group's processes". The rows need the first, so the second now says when a dispatch's containment settles. That condition is met by a process recorded as not ended, and by a group, directory or dispatch recorded in place of processes L0 could not read.

## The placements

- **Where a sign is kept.** A process not ended and a failed read stay in the dispatch's entry, under `unended` and `unread`. An unreadable record is its own sign. A failed write mid-run lives in L1's memory, in `groups.mjs`, and a write that did not complete is the record's temporary file. The entry was already the place each was recorded; only its removal changed.
- **The one refusal point.** L1's `dispatch`, which every dispatch passes. L1 reads the signs in the same synchronous step as L0's spawn, so no sign can arise in between. That answers `### R-STATE-36 — Work beside a sign`'s second row without a second check.
- **The stop.** L3, which already owns the halt and the hold, ends the run. L1 hands it signs on every dispatch outcome and in `take`'s synchronous claim.
- **Attempts.** L3 hands L2 no outcome of a dispatch a sign kept from starting, so L2 counts nothing for it, with no change to L2's counting. #1478's "What it changes underneath" expected the change in L2's count.
- **At a start.** The reap reads the temporary file before any write. The reap's own write would otherwise replace the file and lose what it named.

## The residual

A write that leaves out a process, then an exit cleanup whose write also fails with no temporary file left, leaves the next start nothing to read. That is the reason the rows give for a failed write followed by a kill outright. The pull request asks the owner whether it stands.
