ABOUTME: Card #1451's resumed work under the owner's recorded-merge ruling.

# Trust only the recorded merge parents

Owner ruling M8-U93, recorded on #1293 at issuecomment-7071183670, keeps MERGE_HEAD as
its only trusted source. The PM applied that ruling to #1451 in acceptance revision
9eedc978bc2e and answered the maker's escalation at issuecomment-7071204879.

The automatic linked-worktree fixture runs the shared assertion in both commit hooks.
It observes the refused merge without a new HEAD, the per-worktree merge record, and
then the completed commit's exact two parents. Three more fixtures refuse inherited
GITHEAD labels on ordinary, squash and recorded-merge states.

Measured on 2026-11-22 UTC with npm test's named-file runner, the diagnostic regression
failed on the missing literal git commit before the message changed. Its retry passed.
The affected gate-closure and git-repository files then passed with tests=32, pass=32,
fail=0. Start load was 14.41 and end load 14.06, from uptime. Full output remains in
1451-revised-affected.log in the dispatched scratch directory. Earlier baseline and
historical failures remain on #1451; they are not erased by this revision.

The consumer search covers imports of both test files and commitParents throughout
test, scripts and workflows, plus the suite manifests and package scripts. Existing
helper functions retain their behaviour; no consumer outside the card needs an edit.
Existing test-line removals remain G1's ABOUTME and original pin assertion/comment.
No test is deleted or skipped, and no requirement declaration is added.

The first resumed commit-hook suite refused the commit: tests=5986, pass=5982, fail=2,
cancelled=2. Start/end uptime loads were 12.65/40.68. The no-clock continuing-maker
parent timed out with a cancelled child; J16 and L7 failed positive waits in loop-world.
Each parent passed alone after load dropped. These are the open #1317 settling family;
complete failure and retry output stays on #1451 under the write-scope override.
L7's first isolated observation passed at load 14.36 and is excluded from the required
low-load proof. Its qualified repeat passed with a guarded start load of 10.88671875.
