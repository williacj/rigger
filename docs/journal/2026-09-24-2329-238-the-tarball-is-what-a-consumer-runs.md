ABOUTME: Records card #238, which gave the package a `files` list and added the first test that
packs the checkout, installs the tarball outside it and runs the installed command.

# 2026-09-24 — The tarball is what a consumer runs

Until this card the package shipped whatever npm found. `npm pack` at `91b4d01` (npm 11.17.0,
fresh clone) put 164 files into a 381,218-byte tarball, docs, tests and our own `.claude/`
included. The owner's ruling U30 = A narrows it to `src/`, `templates/` and `scripts/`, plus
what npm always adds. At this card's head the same command gives 34 files and 95,160 bytes.

M0 proved the install by hand, so nothing held it afterwards. The new tests in
`test/package.test.mjs` pack the head and install the tarball offline, in a directory outside
the checkout. They run the installed `rigger` from there, never from the checkout (`R-SAFE-5`).
Dropping `src/` from `files` was tried as a mutation. The listing test and both install tests
went red, and the install tests failed on `ERR_MODULE_NOT_FOUND`. npm still packs the declared
`bin`, so the command is there, but it cannot import `verbs.mjs`. The listing test would catch
that mutation alone. The install tests are for what no listing shows: code under `src/` that
reads a file the tarball does not carry.

`doctor` asks `gh` and the agent CLI, and both of them reach the network. The test runs it under
a `PATH` holding only `node` and `git`, so both checks report "not asked" and nothing leaves the
machine. That still proves what the card asked, which is that the installed tarball prints its
report. It says nothing about whether those two checks pass on a signed-in host.
