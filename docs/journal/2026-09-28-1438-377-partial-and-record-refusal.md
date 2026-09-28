ABOUTME: Journal for #377 (M2-05d): a start removes a stopped writer's partial record, and a
refused record removal after a clean run rejects with a code and the command's result.

# #377 — No partial record left behind, and a refused removal says what ran

## What was built

- `src/execution/groups.mjs` gained `removePartial`, and L1's kill of recorded groups calls it
  once every entry has been acted on. Before, a start whose record held no entry returned without
  writing, so a partial file left by a writer killed before its rename stayed in `.rigger/` until
  the next dispatch wrote the record.
- A partial file the start cannot remove fails nothing by itself: the call appends an L1
  `record.partial-kept` event naming it and why, and rejects on it only where the sink refuses
  that event.
- A dispatch whose record refuses the entry's removal after the command settled now rejects with
  `RECORD_REFUSED`, exported beside `dispatch`, carrying the result and the record's failure as
  `recordFailure`. Before, it rejected with the bare `EACCES` the file system threw.

## What we learned

- **Only the empty record kept the partial file.** A start whose record held any entry already
  rewrote the record, which replaced the partial file, so the new test for that case passed
  before the change. It is kept as the evidence that the complete entries are still read and
  acted on. The test for the record holding no entry, and for no record at all, failed first on
  its first case, the record `[]`, finding `[ 'groups.json', 'groups.json.partial' ]`.
- **The removal comes after the kills, and is best effort.** The first head removed the partial
  file straight after the read, ahead of the kill loop. `rmSync` with `force` still throws on
  `EACCES` and on a directory, so the engineer's judge showed a start that left a recorded group
  alive where the base had killed it (verdict on PR #379, B1). The tests for a state directory
  that refuses writes and for a partial record that is a directory each failed on the live group
  before the change. A record that cannot be read still fails whole before anything is touched.
- **The removal-refused fixture waits on the record, not on luck.** The command spins until the
  record names its own group before it makes the state directory refuse writes. Without that, its
  `chmod` could in principle land before L1 writes the entry, which follows the spawn by one
  synchronous step while the child runs on its own. This is a judgment; no run was seen to lose.
- **The refused `record.partial-kept` test discriminates.** Mutation, at the working tree on
  2026-09-28: the anchor `if (failure === undefined) failure = new Error(unrecorded);` found once
  in `src/execution/run.mjs`, replaced with `void unrecorded`. `npm test -- test/kill-recorded.test.mjs`
  still ran all 21 tests. Only that test failed, on "the call settled without rejecting". The
  file was then restored, and the anchor was found once again.
- **No `// proves` declarations.** #377 claims no requirement. R-STATE-4 is M6's to close and
  R-STATE-10 is #349's. Under `D17` rule 3, a test claiming one takes it out of the counted gaps
  for good, so a declaration here would stand as the claim those cards close on.
