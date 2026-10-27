ABOUTME: Card 1011's removed-closer wording, placement ruling, and test-first implementation evidence.

# Resume's removed closer reason

Card [#1011](https://github.com/williacj/rigger/issues/1011), acceptance revision
`52f2a47c9ed3`, defines completion. Its
[pre-dispatch ruling](https://github.com/williacj/rigger/issues/1011#issuecomment-6434898371)
makes only the reason printable and places the removed-closer words beside `closerLine` in
`src/cli/doctor.mjs`.

`removedCloserLine` writes those words through the existing `printable` function. `resume`
hands it each whole removed closer. The kind, path and time keep their previous formatting.

Before source changes, the Lands-in search under `test/` found the existing resume escaping
check, shared formatter checks and journal classification checks. They required no additional
path or existing test-line edit.

The recorded TDD reds were the missing formatter's ordinary wording, resume's missing
delegation, and a removed reason whose line feed was still raw. Each was followed by the
minimal implementation and a green rerun. The remaining Table A cases were added individually
after the existing printable function supplied their behavior.

Measured by `npm test` at base `94ed1ae2`, the deterministic baseline reported tests=3359,
pass=3359, fail=0. The host-slot log recorded one-minute loads 4.92 and 5.21 at its start and
end. The affected named deterministic run reported tests=43, pass=43, fail=0. The initial
affected host run reported tests=18, pass=18, fail=0. Full outputs are retained under the
dispatch's scratch directory, in `1011-maker/`; the pull request carries the final-head,
fresh-clone and guarded-mutation evidence.

The first commit hook refused the new test adapter's dynamic `gitIn` forwarding call in
`test/git-environment.test.mjs`'s repository-fixture audit. The correction keeps the shared
fixture and explicitly asserts and executes only `repoRoot`'s `rev-parse --show-toplevel` read.
The failed full output is retained as `1011-maker/commit.log`.
