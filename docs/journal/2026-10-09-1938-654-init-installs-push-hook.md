<!-- ABOUTME: Records why init installs a consumer push hook and how the hook checks were tested. -->
# Init installs the consumer push hook

Card #654 makes `init` fork a single consumer `pre-push` hook and set `core.hooksPath` through L0. The hook keeps the default-branch refusal from Rigger's live hook, while the live suite gate remains only in the checkout. The template destination is explicit because a provider does not own Git's hook directory.

The preflight asks Git for the repository root, effective hook path, and existing executable hooks before writing a file or changing config. This matters when a local hook path would hide a global or included setting, and when switching paths would silently disable hooks in Git's active hooks directory. A second run leaves both the file tree and config as it found them.

The initial full-suite baselines failed on the `never-stop.test.mjs` censusExit guard while other suites ran concurrently. The coordinator's C18 permitted one isolated rerun. At a one-minute load of 8.22, that rerun passed 2,558 tests: 2,541 passed, 17 skipped. The affected init tests then exposed older fixtures that assumed the origin URL was `init`'s only Git question. Those fixtures now keep their controlled origin answer while the new questions go through L0 to real Git.

The first full suite after the implementation found that the new linked-worktree test called `git worktree add` directly. `test/git-environment.test.mjs` requires repository construction through its fixture, so the test now calls `worktreeAt`. The next full suite passed 2,574 tests: 2,557 passed, 17 skipped, 0 failed.

Round 1 judges found that `--absolute-git-dir/hooks` names a linked worktree's private directory, while Git runs hooks from the shared one. The preflight now asks `git rev-parse --git-path hooks` when it would set `core.hooksPath`; an already correct local or worktree-scoped setting leaves those hooks alone. The review also exposed an inaccurate ownership report on a second run and a missing-target regression, both covered by new tests. The subdirectory refusal now asserts the actual repository top level named in its output.

The revised working-tree suite passed 2,580 tests: 2,563 passed, 17 skipped, 0 failed. It began at a one-minute load of 9.63; load rose during the run, so the later fresh-clone check must measure its own qualifying start and end.

Round 2 judges found that a refusal test could mistake the target path for the repository top level. Three tests now require the exact `inside the repository at <top level>;` clause. With that clause removed in mutation M7, all three failed; restored, all passed.

Git's exit 128 also covers unsafe ownership, an invalid `.git` file and a bare repository. Real-Git tests first showed `init` writing 16 files in all three. The preflight now treats 128 as a nonrepository result only after checking that no `.git` entry or standard bare-repository entries appear in the ancestry. The check is deliberately a veto rather than a substitute for Git's discovery: a nonrepository carrying those entries is refused too, so an ambiguous failure cannot authorize writes.
