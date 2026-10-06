ABOUTME: Records why the command-gate fixture must remove a hook's Git redirect before testing another repository.

# The hook environment and the repository under test

Git gives a linked worktree's pre-commit hook `GIT_DIR` for the worktree being committed. A suite launched by that hook inherits the variable. The command-gate test builds its own repository with a different default branch, but its gate child previously inherited the hook's `GIT_DIR` and answered for the committing worktree instead.

At base `4063c2e`, `npm test -- test/command-gate-hook.test.mjs` ran from this card's worktree on 2026-10-06 with `TMPDIR` outside the checkout. The fixture commit's real pre-commit hook ran both literal-refspec tests. Both failed on `0 !== 2`; the hook refused the commit. The full runner output is in `c670-logs/red-hook-git-dir.log` in this card's scratch directory.

The test helper now gives its gate child `gitEnvironment()`, as the Git fixture does for its own children. The hook test passes with both literal-refspec cases green, and separate tests show the gate still honors an explicit `GIT_DIR` naming a second repository. The gate itself was left alone: the redirected repository is the one an actual command from that session would use.
