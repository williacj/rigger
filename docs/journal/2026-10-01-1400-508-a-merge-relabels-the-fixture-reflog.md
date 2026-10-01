ABOUTME: Journal for #508: under `git merge`'s pre-merge-commit hook the fixture's own git writes
the reflog under `GIT_REFLOG_ACTION`, so `@{-1}` names nothing and two worktree tests red.

# #508 — a merge relabels the fixture's reflog

**The git child that inherits it is the fixture's.** `git merge` exports `GIT_REFLOG_ACTION` to
the hook, the hook runs `npm test`, and `gitIn` (`test/git-repository.mjs`) handed every fixture
git `gitEnvironment()`, which keeps every variable but the five that redirect git. So
`previousCheckout`'s `git switch -c owner-feature`, its commit, and its `git switch` back each ran
with the variable set.

**Git writes the variable's value in place of the message.** With git 2.54.0 (Apple Git-157) on
macOS 27.0, on 2026-10-01, a probe run through `npm test` with
`GIT_REFLOG_ACTION="merge origin/main"` called `previousCheckout` and printed the reflog it wrote:

```
50691c9 HEAD@{0}: merge origin/main
a5188f8 HEAD@{1}: merge origin/main: owner-feature's own commit
50691c9 HEAD@{2}: merge origin/main
50691c9 HEAD@{3}: merge origin/main: fixture
```

The two switches wrote `merge origin/main` where `checkout: moving from main to owner-feature` and
its return belong. `@{-1}` is resolved from `checkout: moving from` entries alone, so
`git check-ref-format --branch @{-1}` there exits 128 (`'@{-1}' is not a valid branch name`)
whether or not the reading git inherits the variable. That is the check at `:398` and at `:414`
of `test/worktrees.test.mjs`. At e7734b6 under that variable, each of ten runs of that file
failed both tests there, 38 passing, each run started at a one-minute load at or below the host's
12 CPUs. Under the hook itself it is the same: in a scratch clone, `git merge --no-ff` of
0934433 into a local branch at e7734b6, from a shell with `GIT_REFLOG_ACTION` unset, ran the
suite, failed those two tests at `:398` and `:414` and no other, and was refused.

**L0's own resolution does not move with it.** In the same probe, a repository whose reflog was
written with the variable removed held `checkout: moving from` entries. L0's `acceptsBranch('@{-1}')`
there, its git child inheriting `merge origin/main`, answered
`git expands @{-1} to owner-feature, so it is not a literal branch name`, and gave the same answer
with nothing inherited. Reading the reflog never consults the variable; only a write does, and L0
never moves the `HEAD` whose previous checkout `@{-1}` names. So `gitEnvironment` keeps the variable,
and the fix is the fixture's: `gitIn` withholds `GIT_REFLOG_ACTION` from the fixture's git.

**A repository the owner switched in under the variable would answer differently, and correctly.**
Git's `@{-1}` there names nothing, and L0 asks git rather than the reflog (`D16` rule 1), so it
reports what git reports. That is git's answer, not a Rigger fault.

**Removing the switch back does not reach either guard.** The card asked that each test still
fail at its own "git refuses @{-1}" check with `previousCheckout`'s `git switch` back to the
current branch removed. Measured at be625f4 with nothing set, it does not: the switch to
`owner-feature` alone writes `checkout: moving from main to owner-feature`, so `@{-1}` names
`main` and git accepts it. The test at `:394` passes its guard at `:398` and fails at `:399` on
`'main\n'` against `'owner-feature\n'`; the test at `:407` passes outright, since `@{-1}`
printed back as `main` is still a changed name. What does reach both guards is a previous
checkout with no `checkout: moving from` entry at all, which is what the inherited variable
made at the base.
