ABOUTME: A journal entry from card #103: Two failure modes, one output, and the guard that reads
ABOUTME: the wrong thing

## 2026-09-23 — Two failure modes, one output, and the guard that reads the wrong thing

The card set out two ways an unguarded mutation lies, and they look opposite: a replacement that
silently did not apply reports green, and one that lands and breaks the file reports a failing
test. The first exonerates code that is broken, the second manufactures the red you wanted. So
the obvious guard list had one entry per mode — check the anchor for the first, run `node --check`
for the second.

That is the wrong split, and measuring the third mode is what showed it. A mutation that parses,
loads, and then hangs — `at += 1` to `at += 0` in the scanner's word reader — produces output
indistinguishable from the syntax break: `tests 1 / pass 0 / fail 1`, `not ok 1` naming the test
*file*, `location` at `:1:1`, `error: 'test failed'`, and no assertion under it. `node --check`
passes it. The bytes changed, `git diff` saw them, the module loaded, the restore was byte-exact.
Every guard in the byte-and-parse family held.

So the second and third modes are one failure in the output and two causes underneath, and
`node --check` is a pre-filter for one cause rather than a guard for the mode. What separates a
manufactured red from a real one is the **count**: the run either reached a verdict on the tests
you aimed at, or it reported the file instead. Thirty-one tests were aimed at and one was
reported. A guard written per cause will keep missing causes; a guard written on the count misses
none of them, because the thing being asserted is that a verdict exists.

One correction to the account that reached this card, since the card's own standard applies to it.
The hang was relayed as the file failing to load. It is not a load failure: the module loads and
the tests begin. `node --test` runs a test file in a child process and books one whose process
ends without a verdict as a single failing test, whatever ended it — here SIGTERM from an external
timeout, `exitCode: 143` in the TAP. Unkilled, the run does not finish at all and reports no
counts either, which is the same refusal by a different route. Reproducing it rather than
believing it is what turned a third guard into a correction of the second.

The other thing worth writing down is where the statement went. The instinct was the reviewer's
skill, because a judge is who reads a mutation claim. The record says otherwise: seven of the
eight mutation claims this repository holds are in a maker's own pull request body and one is in a
judge round. A bar only a judge loads would have reached one of eight. It went in the `tdd` skill,
which a maker loads before its first test body, with a pointer from the judge's lens.
