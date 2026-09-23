ABOUTME: Records how card #116 made the ruled-out pattern test independent, and the limit that
ABOUTME: remains when both sources are changed together.

## 2026-09-23 — An oracle needs a second source

The positive check recovered the word from the pattern it tested. That caught a bracket that
slipped, because the class then held two characters, but it accepted a wrong letter outside the
class. A test asserting that `corp[u]x` matched the word it derived from `corp[u]x` was true and
still guarded the wrong word.

The test now compares that derived spelling with a separately written reverse spelling. Reversing
it at runtime lets the repository keep its prohibition on writing the ruled-out word plainly.
The single-letter mutation reached all eleven focused tests and failed on that comparison; valid
alternative bracketing reached all eleven and passed. The last-position bracket has its own test
for the reason the right-slip check cannot run, rather than a bare assertion failure.

This has a deliberate limit. Changing both the pattern to `corp[u]x` and the reversed spelling to
`xuproc` made the eleven focused tests pass. The two encodings force a coordinated edit, but they
cannot prove that the intended word has not changed in both places. The pull request names that
counterexample so a reviewer can judge the claim against what the test actually reaches.
