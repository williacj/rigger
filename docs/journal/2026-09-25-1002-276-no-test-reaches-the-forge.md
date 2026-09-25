ABOUTME: Records card #276, which stops the forge runners spawning the real `gh` under the test
runner, and what running the suite behind a proxy that forwards nothing showed.

# 2026-09-25 — No test reaches the forge

The suite reached github.com on every run. Measured on a fresh clone at `e55f49c` with Node
26.5.0, behind a local proxy that recorded every request and forwarded none, `npm test` passed
462 of 462 and the proxy recorded three `CONNECT api.github.com:443`. The source at that ref
spawns the installed `gh auth status` three times: `test/doctor.test.mjs` asks it directly, calls
`ghAuth()` with no stand-in, and runs the bin, whose `doctor` asks it too. That these three are
the three requests is read from the source; the proxy does not say which process sent each.

The guard sits in the runners' default spawn, the one place the forge's command is named. Every
side and every caller reaches `gh` through it, so a test that fails to pass its stand-in on
anywhere between is refused there. It reads `NODE_TEST_CONTEXT`, which `node --test` sets in each
test file's process. Measured with Node 26.5.0: `node --test` sets it to `child-v8`, a file run
directly by `node` has none, and `--test-isolation=none` sets none but passes `--test` in
`execArgv`. The suite runs `node --test` with the default isolation, so only the variable is read.

The variable is inherited, so a bin a test spawns refuses too. Two tests spawn one that asks the
forge: the wiring test in `test/doctor.test.mjs` and the installed-tarball test in
`test/package.test.mjs`. Each now takes the variable out of the child's environment, and each
names the `gh` the child finds: a recording stand-in first on the path in the first, and no `gh`
at all in the second.

The check that `doctor`'s answer agrees with `gh auth status` keeps its relation against a
stand-in `gh` that answers each recorded result in turn, as the owner confirmed on #276.
