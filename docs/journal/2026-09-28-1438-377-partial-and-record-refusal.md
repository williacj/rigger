ABOUTME: Journal for #377 (M2-05d): a start removes a stopped writer's partial record, and a
refused record removal after a clean run rejects with a code and the command's result.

# #377 — No partial record left behind, and a refused removal says what ran

## What was built

- `src/execution/groups.mjs` gained `removePartial`, and L1's kill of recorded groups calls it
  once the record has been read. Before, a start whose record held no entry returned without
  writing, so a partial file left by a writer killed before its rename stayed in `.rigger/` until
  the next dispatch wrote the record.
- A dispatch whose record refuses the entry's removal after the command settled now rejects with
  `RECORD_REFUSED`, exported beside `dispatch`, carrying the result and the record's failure as
  `recordFailure`. Before, it rejected with the bare `EACCES` the file system threw.

## What we learned

- **Only the empty record kept the partial file.** A start whose record held any entry already
  rewrote the record, which replaced the partial file, so the new test for that case passed
  before the change. It is kept as the evidence that the complete entries are still read and
  acted on. The test for the record holding no entry, and for no record at all, failed first on
  its first case, the record `[]`, finding `[ 'groups.json', 'groups.json.partial' ]`.
- **The partial file is removed after the read, not before.** A record that cannot be read fails
  whole before anything is touched, so the start that names the torn record leaves the directory
  as it found it.
- **The removal-refused fixture waits on the record, not on luck.** The command spins until the
  record names its own group before it makes the state directory refuse writes. Without that, its
  `chmod` could in principle land before L1 writes the entry, which follows the spawn by one
  synchronous step while the child runs on its own. This is a judgment; no run was seen to lose.
