ABOUTME: A journal entry from card #103: Two failure modes, one output, and the guard that reads
the wrong thing

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
skill, because a judge is who reads a mutation claim. The record says otherwise, and more sharply
than the count first written here: **no judge's own report is among the eleven sites, and no judge
verdict is recorded as a review or in a verdict store at all.** Every one of the eleven sits in a
maker's own report — ten pull request bodies, plus one maker's own round-2 comment, over every
pull request and issue on 2026-09-23. The reason is structural rather than accidental: `gh api
.../reviews` returns zero reviews on every pull request, and the verdict store `M5` installs does
not exist yet. Judge mutation claims are real — card #33 round 2, #31 and #35 each made one — and
what survives of them is quotation rather than record: card #103's own body quotes #33 round 2
verbatim, card #24's body quotes another judge's eight-mutation report, and issue #97's comments
record a third at second hand, while #31, #35 and #33 carry no mutation mention at all. **A
quotation is a record the card's author chose to make, not one the judge creates or could rely
on.** So the statement went in the `tdd` skill, which a maker loads before its first test body,
and the pointer from the judge's lens is the only thing that reaches a judge by design:
necessary rather than a courtesy.

The first version of that paragraph said seven of eight, and one site in a judge round. All three
figures were wrong, and the one that mattered was the split: the site read as a judge's is the
maker's own round-2 reply, which says the body above is edited in place and addresses the judge in
the second person. **The conclusion got stronger when the numbers got right**, which is the
argument for measuring a claim you already believe. The count also moves — two more maker bodies
appeared while this card was open — so the figure carries the date it was taken, and the zero is
the part to read.

One soft spot, named because a future edit can walk straight through it. `test/mutation-claim.test.mjs`
pins the set of seven bolded requirement names, so any body can be reworded freely — including
reverted to the pre-correction wording this entry's own measurement overturned, requirement 3's
name left standing and the test still green. Pinning body text would make the document
unmaintainable, so the gap stays open deliberately: the sentence most worth protecting is the one
nothing protects.
