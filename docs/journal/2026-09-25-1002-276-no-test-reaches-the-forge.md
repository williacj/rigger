ABOUTME: Records card #276, which has `npm test` put a refusing `gh` first on every test's PATH,
the production guard it replaced, and what running the suite behind a proxy that forwards nothing showed.

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

The first round took the variable out of the environment of a child that runs a verb asking the
forge, and relied on the path the test built to keep the installed `gh` from it. The Codex judge
found that gap on #282: a child handed the test process's own path instead ran whatever `gh` that
path found. The card was revised to cover the class. Under the test runner, a runner now spawns
only the stand-in its test declared in `RIGGER_GH_STAND_IN`, and only where the path finds it.
The variable stays in the child's environment. A child that lost the path its test built finds
some other `gh`, and fails without running it. The wiring test in `test/doctor.test.mjs` and the
installed-tarball runs in `test/package.test.mjs` declare their stand-ins that way.

The check that `doctor`'s answer agrees with `gh auth status` keeps its relation against a
stand-in `gh` that answers each recorded result in turn, as the owner confirmed on #276.

#286 (the fake `gh`, #223) merged while this was in review, and the two broke each other. Its
in-process tests put the fake first on the path without declaring it, so the guard refused them.
Its recording ran each adapter test file as plain `node` with `NODE_TEST_CONTEXT` taken out, so
the guard was off inside those files, and this card's own guard tests failed there. It took the
variable out because `child-v8` sends the child's report to the parent's runner. With Node
26.5.0, a file run by `node --test-reporter=tap` with the variable set to a value the runner
does not read still prints its own TAP report. So the recording now sets such a value, and the
guard stays on in the recorded files. The fake is declared by its path wherever a test puts it
first.

That guard was the wrong place, because the marker it keyed on is one any test can take away.
The Codex judge's second return showed a default-isolation test spawning a child with its own
environment minus `NODE_TEST_CONTEXT`. That child called `ghAuth()` and reached whatever `gh` was
on its path, and #286's recording did exactly that. The owner moved the guard out of production
code (option A), and the architect ruled where it lives. `npm test` now runs `test/suite.sh`,
which puts a refusing, recording `gh` first on `PATH` and runs `node --test` with every argument
forwarded. It fails the run when anything called that `gh`, whatever the calling test asserted.
The refusal lives in the path every test and every child inherits, not in a variable a child can
lose. What stays open is a test that builds its own path around the installed `gh`, which the
owner confirmed as a review matter. Nothing under `src/` differs from `main`. Every test and
helper built on the production guard went with it. #286's tests are `main`'s again, because the
fake `gh` they put first on `PATH` already sits ahead of the refusing one. The `D16` probe finds
the installed `gh` by taking the harness's directory off `PATH`.

The Codex judge then found that the harness wrote its record path into the refusing `gh`'s source
inside single quotes. A `TMPDIR` holding an apostrophe broke that quoting. The refusing `gh` then
exited 2 without recording, and a run whose tests called it passed. The stand-in `gh` in
`test/stub-gh.mjs` had the same fault. Now each script finds its files beside itself, through its
own path, `$0`, and no path is written into any script's source.

The Claude reviewer then found that the harness put its directory on `PATH` as `TMPDIR` spelled
it. A `TMPDIR` holding `:` split that entry in two, so no entry held the refusing `gh`. A relative
`TMPDIR` gave an entry that a child working in another directory resolved to nothing. Either way
the calls reached whatever `gh` came next. The harness now names its directory absolutely, and it
stops before any test runs when that name holds a `:`.
