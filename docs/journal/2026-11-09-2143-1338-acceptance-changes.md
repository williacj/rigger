ABOUTME: Records card #1338's derivation of acceptance changes in `report`, and which of its Table D
rows held at the merge base.

# Acceptance changes in report

Card [#1338](https://github.com/williacj/rigger/issues/1338), acceptance revision `699b91216c2b`,
adds to L2's section of `report` the signal "Acceptance changes and who made them" defines:
each change and who made it, content deleted, growth after admission, changes during the card's
maker dispatch, and each card's author. The merge base is
`1e7e3ce0aec4f40a018321c45f1afb4a93df5802`.

At the merge base `report`'s `l2` answer carried `hostFaults`, `escalations` and `rounds`, and no
acceptance-change signal, and its printed L2 section had no line for one. So no row of Table D
held there, D3 and the other rows whose required derivation is "no change" or "not among who
made it" included: with no signal, the absence a row requires could not be read. The deterministic
run at the merge base with the new test file present measured this, through the host-wide suite
slot: tests 5569, pass 5538, fail 31. The 29 tests of `test/report-acceptance-changes.test.mjs`
failed on the missing answer or the missing printed heading. The other two were the
temporary-directory check, which the file then failed by calling `mkdtempSync` itself, and the
stale matrix.

The test file as committed at this card's head, run against the merge base's `src/` with
`sh test/suite.sh test/report-acceptance-changes.test.mjs` through the suite slot, exits 1 with
tests 29, pass 0, fail 29. The 26 derivation tests each fail on
`AssertionError [ERR_ASSERTION]: report derives no acceptance changes: ["hostFaults","escalations","rounds"]`.
The three printed-section tests fail on
`AssertionError [ERR_ASSERTION]: L2 prints "    acceptance changes, each with who made it":`,
`AssertionError [ERR_ASSERTION]: L2 prints "    acceptances that grew after admission":` and
`AssertionError [ERR_ASSERTION]: L2 prints "    each card's author":`.

| Row | At the merge base |
|---|---|
| D1 | needed a change |
| D2 | needed a change |
| D3 | needed a change |
| D4 | needed a change |
| D4b | needed a change |
| D5 | needed a change |
| D5b | needed a change |
| D6 | needed a change |
| D7 | needed a change |
| D8 | needed a change |
| D9 | needed a change |
| D10 | needed a change |
| D11 | needed a change |
| D12 | needed a change |
| D12b | needed a change |
| D13 | needed a change |
| D14 | needed a change |
| D15 | needed a change |
| D15b | needed a change |
| D16 | needed a change |
| D17 | needed a change |
| D18 | needed a change |
| D18b | needed a change |
| D19 | needed a change |

The printed lines sit after "each escalation is listed under its run" and before the rounds block,
so `test/report-escalation-rounds.test.mjs`'s read from the rounds heading to the section's end is
unchanged, and no existing test line changed. M8-06b had not merged when this card's head was
proposed, so every stream here is hand-written in the shape `ARCHITECTURE.md` gives
`acceptance.history`.
