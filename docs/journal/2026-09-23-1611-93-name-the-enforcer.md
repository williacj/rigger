ABOUTME: Records why card #93 names a judge as the enforcer of tests for new requirements
instead of attributing enforcement to a build check that does not exist.

# Name the enforcer

The instruction files carried the right obligation for a new requirement but assigned it to a
build check that does not enforce it. `scripts/build-test-matrix.mjs` checks whether its generated
document is current; regenerating clears that finding without adding a test. `D17` rule 1
preserves the obligation, and rule 7 assigns its enforcement to a judge.

The three locations the card named were not the whole live set. The TDD skill also carried the
old promise, in both its working copy and template. The PM prompt and proposal skill also have
template twins. All seven edited files now use the same authority, and a search of the active
instruction files found no remaining sentence promising the missing build check.

The instruction-budget tool reported 1,991 words against 2,500 after the edits. The suite and
the document path and reference checks passed, so the change remains a correction to the
instructions rather than a new check or a delta to D17.
