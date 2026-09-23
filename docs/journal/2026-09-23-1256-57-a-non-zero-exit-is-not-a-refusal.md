ABOUTME: A journal entry from card #57: A non-zero exit is not a refusal

## 2026-09-23 — A non-zero exit is not a refusal

Card #57 closed a false green. `scripts/absorption-check.mjs` had two invocation branches and no
else, so an argument vector matching neither fell off the end of the module and Node exited 0
having compared nothing. The fix is an else. What the card cost was the evidence around it.

**Two of the twelve tests passed against the script they were written to fail against.** The
acceptance asks for a test per behaviour that fails at `65a7de7` and passes after, so the whole
script was swapped back to `65a7de7` and the suite run. Seven went red. Two of the five that
stayed green were supposed to — they pin what the card promised not to change. The other two were
green for reasons that had nothing to do with what they claimed.

`three document paths are refused rather than comparing the first two` asserted only a non-zero
exit. At `65a7de7` three paths ran the two-document branch on the first two, which threw, which
exits 1. The test was reading a crash as a refusal. `the two-document form names the file and the
heading` asserted the two strings on stderr, and at `65a7de7` the unhandled throw printed its own
message inside the stack trace, which carries both. Both assertions were satisfied by the defect
they existed to catch.

Asserting the refusal's own words — `no such invocation` — separated the first. The second
separated only once a sibling test forbade a stack frame on stderr, which is why the acceptance
asks for that separately: the naming and the absence of a trace are two claims, and one assertion
covering both is satisfied by the trace. This is the journal's own "a refusal by accident reads
exactly like a control", one entry on, in exit-code clothing rather than heredoc clothing.

**A whole-file swap is a coarse mutant, and it flattered four assertions.** Eleven further
mutations, one per assertion, each guarded on the blob hash moving, on `git diff` moving, on
`node --check` still parsing and on a byte-exact restore afterwards, each killed exactly the test
it was aimed at. The one that reinstates the original defect — the final `process.exit(2)` back
to `process.exit(0)` — killed four, which is the measure of what the card was worth. Without the
per-assertion pass, `tests 12 / pass 5 / fail 7` would have been reported as twelve tests holding
twelve behaviours, and two of them held nothing.

**And a tension inside the acceptance, worth naming rather than working around.** One item asks
that every behaviour above it have a test failing at `65a7de7`. Two of the behaviours above it
are *unchanged* at `65a7de7` by their own wording, so a test that failed there would be proof the
card broke them. The two readings cannot both hold. An acceptance that pins something still and
also demands its test move is asking for opposite evidence in one sentence, and the cheapest place
to catch that is while writing the acceptance, where the item that says "unchanged" and the item
that says "fails against the old ref" are a paragraph apart.
