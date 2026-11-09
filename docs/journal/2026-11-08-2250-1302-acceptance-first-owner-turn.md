ABOUTME: Records the merge-base outcomes for card 1302's acceptance-refusal and owner-turn tests.

# Acceptance before work and the owner's turn

Card #1302, acceptance revision f9f7b705ca80, closes the claiming-test gaps for R-CARD-1 and
R-ESCALATE-5. Its scope includes the generated matrix after the author's resolution of the
maker's pre-code scope escalation on the card.

Measured with Node v26.13.0 at merge-base production commit
52fb8a3d15a7f6842436a7295edb52c4b7a4ad35: the full deterministic baseline passed 5,486 tests,
with zero failures or skips. The one-minute load reported by uptime was 2.47 before and 6.44
after. The complete output is retained as 1302-baseline.log in the dispatch's scratch directory.

Measured against that same production source with the added tests: the named-file run using
the pattern `^(acceptance-first:|owner-turn:)` passed 48 tests and subtests, with zero failures
or skips. Uptime reported one-minute loads of 5.61 before and 5.44 after. The complete output
is retained as 1302-claiming-base.log. No production file changed.

| Row | Merge-base outcome | Boundary observed |
|---|---|---|
| C1 | Held; no source change needed | A fenced Acceptance heading is refused by plan, once and run. |
| C2 | Held; no source change needed | An Acceptance section containing only task-list items is refused by all three verbs. |
| C3 | Held; no source change needed | An Acceptance section containing only fenced bullets is refused by all three verbs. |
| C4 | Held; no source change needed | Every item's compared form equals the title; all three verbs refuse it. |
| C5 | Held; no source change needed | On each once/run board, the valid sibling is claimed, registered as a real worktree, and executed by its stand-in maker. |
| E1 | Held; no source change needed | Sound agent markers at the head and acceptance digest lead to the configured Owner verdict column. |
| E2 | Held; no source change needed | The ordinary owner turn emits no review.escalate for its card. |
| E3 | Held; no source change needed | The run's report excludes the ordinary owner turn from its escalation numerator. |
| E4 | Held; no source change needed | A judge's critical verdict on the same fixture adds one escalated card to that run's report. |

Each once/run refusal has independent subtest verdicts for claims and board moves, workspace
creation and registration, dispatch starts, and the valid sibling. The sibling's plan is keyed
by card 12 so its maker exits 7 deliberately. The sibling assertion checks its L1 dispatch.end
exit is exactly 7 as well as the verb's nonzero result.
The invoking tests inject manualClock into L3 and L0; the assertion-only subtests drive no clock.

At ee42c3ca, the wildcard plan did not select that exit act: the maker actually exited 0,
and the verb returned 1 because no pull request was opened. K74 identified this false fixture
premise. Before correcting the plan, the new exit assertion failed for C2 through both once
and run, recording makerExit [0] instead of [7] in 1302-k74-red.log. The fake-forge directory
also takes the invoking test's context for cleanup.

The owner tests drive real L2 transitions and L3 pulls over the fake board and repository.
Report reads their emitted stream. The critical control becomes eligible after the ordinary
turn, making the before/after escalation numerators independently observable as zero and one.

The card's test-first exception applies because these claiming tests pass against merge-base
production. Committed-head proof comparisons and guarded mutation receipts accompany the PR.

Both existing test files retain their original bytes as a prefix, with new imports and tests
appended. The matrix was regenerated with npm run matrix under D8. The diff touches no
Self-hosting path.

Current main later added Table O tests at both verb files’ ends. The K74 push was accepted,
but GitHub initially retained the earlier PR head. Closing and reopening the same PR refreshed
that record and exposed the concurrent append conflicts. The branch update retains main’s
complete test prefixes and appends this card’s blocks after them; it changes no existing test
line against the updated merge base, 1e7e3ce0aec4f40a018321c45f1afb4a93df5802.

Every Table C and E row also held at that updated base: sh test/suite.sh over its production
with the e9334d45 claiming-test overlay reported tests=48, pass=48, fail=0, skipped=0 in
1302-sync-claiming-base.log. This is a measurement of the updated base plus that test-only
overlay, separately from the original-base observations above. No production source changed
between those bases. Updated-head proof and guarded mutation receipts verify the retained
claims after the append resolution. Command/ref/provenance originals are retained privately
under retained-evidence/1302, outside disposable suite and mutation roots.
