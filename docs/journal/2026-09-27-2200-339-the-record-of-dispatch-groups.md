ABOUTME: Journal for #339 (M2-05a): L1's minimal dispatching function, which records each
dispatch's process group in the state directory while it runs and removes it afterwards.

# #339 — The record of dispatch groups

## What was built

- `src/execution/run.mjs` holds L1's dispatching function in its minimal form. It refuses a call
  with no dispatch id, shows the record writable, runs the command through L0's adapter, writes
  the entry in the step that creates the group, and removes it once L0 has emptied the group.
- `src/execution/groups.mjs` holds the record: `groups.json` in the state directory, written whole
  beside itself and renamed over.
- `src/substrate/process.mjs` gained one parameter, `onGroup`, called with the group's id before
  the call first yields. A hand-off that throws has L0 end and record the group before rejecting.

## What we learned

- **A test for "the command never ran" can pass by a race.** The first version checked only for
  the file the command's first action writes. With the record's writable check missing, the test
  still passed, because the check ran before the command had written. It now also asks `pgrep`
  whether the command is running. `spawn` returns only once the child has exec'd, so a started
  command is either still running or has written the file.
- **`syncBuiltinESMExports` lets a test stop a writer part-way through without the writer knowing.**
  A module loaded first with `--import` replaces `fs.writeFileSync` and `fs.renameSync`, and the
  sync carries the change into every named import of `node:fs`. The test asserts the writer died
  by `SIGKILL`, so a writer that stopped using those calls fails the test rather than passing it.

## What failed

- **The first test of where the record writes looked only at the files left behind.** A mutant
  that wrote the partial file beside the state directory, then renamed it into place, passed it:
  nothing was left outside to find. The test now watches every writing call of `node:fs` while the
  dispatch runs, and that mutant fails it.

- **The first round left an entry behind on a refused event.** `dispatch` removed the entry only
  when L0 fulfilled. Since #337, however, L0 rejects with `EVENT_REFUSED` only after it has
  emptied the group, so a refused kill event left an entry naming an empty group. Both judges
  found it. The entry is now removed on that rejection as well, and the refusal still reaches the
  caller.
- **Item 7's test still passed by a race after its first fix.** Without the writable check, L0
  killed the spawned command inside the failed hand-off before its first action, so neither
  `pgrep` nor the file saw it (the engineer judge's N1). The test now also reads the stream, where
  L0 records that kill.
- **A fixture process from `test/process-adapter.test.mjs` can outlive its file's run by a
  moment.** `pgrep` right after `npm test -- test/process-adapter.test.mjs` listed one in one of
  four runs at base `061ee47`, and it was gone on the next read. That behaviour predates this card
  and is not changed by it.
