ABOUTME: Records why card 661 distinguishes a missing worktree administrative directory from one the filesystem cannot read.

# A missing administrative directory answers no

The architect's Y1 probe showed that git gives the same exit and diagnostic for a dropped
worktree registration and an administrative directory with no read permissions. Reading the
diagnostic as a definite negative answer let the latter move to Done with its worktree left.
The acceptance requires that unanswered check to hold the card where it is for a later pull.

L0 now reads the `gitdir:` target from the worktree's .git file after a failed recognition call.
Only lstat answering ENOENT for that target proves it is absent. An existing target keeps the
git failure, and any other filesystem error remains a failed check. Recognition no longer
interprets git's diagnostic words, so this distinction does not depend on their language.

The new R-WORK-30 test makes a real worktree's administrative directory unreadable and pulls
its merged Review card. At 94b77f6 with only the test added, npm test ran that test and failed
with "Missing expected rejection." After the L0 change it rejects, leaves Review unchanged,
and names the workspace. Restoring permissions leaves its bytes, modes, registration and
branch unchanged; the later pull removes the workspace and moves the card to Done. The C1
test still requires a missing administrative directory to be a refusal that permits Done.

C30 keeps this branch separate from main. The owner integrates it by merging the PR, and the
pull_request CI run tests that merge result. The acceptance remains revision 2bde6cac5717.
