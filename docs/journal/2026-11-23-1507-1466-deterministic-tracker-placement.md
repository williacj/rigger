ABOUTME: Records the author-approved deterministic placement of card 1466's controlled tracker tests.

# Deterministic tracker placement

The author revised acceptance to K7 `37d960e18a1e` in
[1466#7104910149](https://github.com/williacj/rigger/issues/1466#issuecomment-7104910149).
Done means T8–T14 and T10b run in the deterministic tier, their bodies and helper move
verbatim, process-adapter matches the merge base, the G7 scratch SIGTERM title matches
its merge-base identity, and the required affected and fresh-clone checks are recorded.
Item 27 remains pending owner `ci:full` under the standing sequence.

The eight controlled tests and trackedDispatch moved verbatim to
`test/descendant-tracker.test.mjs`, together with their fixture and manual-clock imports.
The file is on none of the suite lists. `test/process-adapter.test.mjs` is byte-identical
to merge base `3e325ab83911b66a07076d6dc852d9291941075d`. The scratch SIGTERM case retains
its G7 outside-tree fixture and all assertions while restoring the exact base title.
The matrix was regenerated. Production source and fixtures did not change.

Precommit measurements on 2026-11-23 UTC, at head 78811561 plus these local edits,
are retained outside the clone in `codex-1466-tmp`. The Acorn file/title audit first
reproduced the defect: addedDeclared=7 and addedHost=15, exit=1, in
`1466-r9-identities-red.log`. After the edits, the same audit, extended to include
untracked files and assert the exact host cohort, measured addedDeclared=6 and
addedHost=6, exclusively T1–T6, each claiming R-STATE-29 and declaring its host
reason and deterministic counterpart. It exited 0 in `1466-r9-identities-green.log`.

The named deterministic run passed with tests=209, pass=209, fail=0, cancelled=0,
skipped=0 in `1466-r9-deterministic-green.log`, including the moved tracker cases,
exit budget, matrix generator and network inventory. A preceding command mistakenly
included host-listed suite-tiers in the deterministic tier; the harness refused it
before executing tests, exit=1 (`1466-r9-deterministic.log`). That attempt receives
no proof credit. No test assertion or production behavior was changed for this move.

`1466-r9-equivalence.json` records byte equivalence of the moved block and unchanged
production/fixture dependencies. The complete existing-line diff is retained as
`1466-r9-test-lines.diff`; the move removes only card-added lines from process-adapter,
and restoring the scratch title removes its title delta from the merge-base diff.
The original G1–G8 grants cover the remaining base-line edits.

Final-head hook, affected-host, guarded counterexamples, preflight, fresh-clone suite,
CI and publication evidence are retained separately in logs prefixed `1466-r9` and
quoted in PR #1475. The coordinator dispatches independent judges; the maker gives
no review verdict. The clone and scratch remain for coordinator cleanup.
