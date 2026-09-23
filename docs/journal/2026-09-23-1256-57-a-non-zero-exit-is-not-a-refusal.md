ABOUTME: A journal entry from card #57: A non-zero exit is not a refusal

## 2026-09-23 — A non-zero exit is not a refusal

Card #57 closed a false green. `scripts/absorption-check.mjs` had two invocation branches and no
else, so an argument vector matching neither fell off the end of the module and Node exited 0
having compared nothing. The fix is an else. What the card cost was the evidence around it.

**One of the twelve tests passed against the script it was written to fail against.** The
acceptance asks for a test per behaviour that fails at `65a7de7` and passes after, so the whole
script was swapped back to `65a7de7` and the suite run: `tests 12 / pass 5 / fail 7` at the
delivered head `c99724a`, and the same five pass at `e20f65e` earlier on the branch. Four of those
five are supposed to pass — they pin what the card promised not to change, so a red there would be
proof the card broke it. The fifth, `the two-document form names the file and the heading`, passed
for a reason that had nothing to do with what it claimed.

It asserted the file and the heading on stderr, and at `65a7de7` the unhandled throw printed its
own message inside the stack trace, which carries both. The assertion was satisfied by the defect
it existed to catch. It separates only once a sibling test forbids a stack frame on stderr, which
is why the acceptance asks for that separately: the naming and the absence of a trace are two
claims, and one assertion covering both is satisfied by the trace.

A second test was the same shape, caught while the code was being written rather than by the swap.
`three document paths are refused rather than comparing the first two` asserted only a non-zero
exit, and at `65a7de7` three paths ran the two-document branch on the first two, which threw,
which exits 1 — the test was reading a crash as a refusal. Asserting the refusal's own words,
`no such invocation`, separated it. This is the journal's own "a refusal by accident reads exactly
like a control", one entry on, in exit-code clothing rather than heredoc clothing.

**A whole-file swap is a coarse mutant.** Twelve further mutations at `c99724a`, one aimed at each
assertion, each guarded on the blob hash moving, on `git diff` moving, on `node --check` still
parsing and on a byte-exact restore afterwards. None survived, and none killed a test that asserts
anything but the behaviour it removed, which is what a kill count is worth reading for. The one
that reinstates the original defect — the final `process.exit(2)` back to `process.exit(0)` —
kills five at `c99724a`, which is the measure of what the card was worth. Without the
per-assertion pass, `tests 12 / pass 5 / fail 7` would have read as twelve tests holding twelve
behaviours, and one of them held nothing.

**And the figures in the paragraph above moved after it was written, by a later commit of this
same card.** The entry first said eleven mutations, and four kills for that mutant. Both were
measured, and both were true at `e20f65e`, the commit that added the entry. The next commit added
a guard that an option is not a document path — which is the twelfth mutant — and strengthened one
refusal test to assert `no such invocation`, which is the fifth test that mutant now kills.
Neither figure was retyped, and a judge found both stale against the head it was asked to rule on.

A figure in an entry is measured at a ref, so the entry is part of the work rather than a report
filed after it. A commit that changes what a number measures falsifies every number already
written about it, including the ones in the file describing the measurement, and naming the ref
beside the figure is what makes that staleness visible instead of silent. The same round also
carried a count that closed at no ref at all — two of five supposed to pass and the other two not
— which needed no measuring to catch, only adding up.

**And a tension inside the acceptance, worth naming rather than working around.** One item asks
that every behaviour above it have a test failing at `65a7de7`. Two of the behaviours above it
are *unchanged* at `65a7de7` by their own wording, so a test that failed there would be proof the
card broke them. The two readings cannot both hold. An acceptance that pins something still and
also demands its test move is asking for opposite evidence in one sentence, and the cheapest place
to catch that is while writing the acceptance, where the item that says "unchanged" and the item
that says "fails against the old ref" are a paragraph apart.
