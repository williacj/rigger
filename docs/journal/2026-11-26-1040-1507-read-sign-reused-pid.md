<!-- ABOUTME: Card 1507's L0 fix: a start clears a settled dispatch's read sign once a whole-table read shows each tracked pid it could not match is not the process recorded. -->

# Card 1507: a read sign over reused tracked pids

Under owner ruling M8-U154 (https://github.com/williacj/rigger/issues/1293#issuecomment-7196771913), Emend's window stalled because a start kept a settled dispatch's `read` sign for every tracked pid its start-time read could not match, even where a later whole-table read showed the pid held another process. L1 then dropped those pids from `unended` but kept the sign, and no verb cleared it.

`killRecordedGroup` (`src/substrate/process.mjs`) now asks `processSigns`, the whole-table read, about the pids the start-time read missed, and keeps the dispatch's read sign only for a pid that read cannot show gone. A survivor of the start's kill still keeps it as before. Nothing else changed; `src/execution/run.mjs` already drops the reused pids on its own re-check.

A lesson from the controlled fixture: `trackerWorld` answers an empty `ps -A` with exit 1, which `processSigns` takes as a failed read. A real whole-table read always lists launchd, so the row cases seed pid 1 before the process at the tracked pid is reaped.

The first full baseline in this clone ran after the new tests were appended, so it counted their eight go-ahead cases red at the merge-base source; everything else in it passed.
