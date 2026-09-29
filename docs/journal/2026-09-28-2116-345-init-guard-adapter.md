ABOUTME: Journal for #345 (M2-07d): what moving `init`'s `origin` read onto L0 taught, chiefly
that a synchronous git spawn under a stand-in that leaves a child never returns.

# #345 — `init` refuses its own tree, and reads `origin` through L0

## What was learned

- **The old read hung rather than failed.** Before this card `repoSlug` ran git through
  `spawnSync`. Under a `git` stand-in that leaves a child holding standard output, `spawnSync`
  waits for the pipe to close, which never happens. In the red run, on this branch before the
  source change, `node --test` reported the first such test at 278,884 ms. It ended only when the
  child was killed by hand. The adapter bounds the same call by its timeout, and by
  `OUTPUT_BOUND` where a process outside the group holds a pipe.
- **A test's own git is exposed to its stand-in.** The fixture repositories are built by running
  `git` as PATH finds it. Any fixture built while a stand-in is first on PATH runs the stand-in
  instead, and one that leaves a child hangs the test the same way. So every test here builds its
  repositories before it puts a stand-in on PATH.
- **The guard needs no git.** `init` writes into the directory it is given, never the one git
  would name above it. So it compares the target itself with `sameTree`, before any spawn, and a
  refusal sends git nothing.

## What moved

- The guard's `git` stand-ins moved from `test/guard-probe-kill.test.mjs` into
  `test/process-fixtures.mjs`, so `init`'s tests share them rather than copy them.
- `repoRoot`'s way of asking git became `gitAnswer` in `src/cli/doctor.mjs`, which `repoSlug`
  also uses. The refusal text became `sourceTreeRefusal`, which the guard and `init` share.
