ABOUTME: Card #659's gate diagnostic, its forge read boundary, and the evidence gathered while making it.

# Doctor's required gate check

Card [#659](https://github.com/williacj/rigger/issues/659) specifies the rule, environment and config tables the diagnostic answers. Its acceptance is the completion bar. The placement comes from the architect's B1 ruling on that card: environment reads belong to `repositoryReads`, and `doctor` composes the verdict. The architecture edits follow the owner's P50 and P51 text on the card.

The gate line reads the default branch before its effective rules. It compares each integration pin against the environment variable, and compares the one custom branch policy literally against that default branch. An absent environment suppresses its child reads. An unusable config leaves one unasked line and sends no gate request. Each remaining diagnostic fault stays on the same line.

The forge reads take environment, variable and secret names as arguments. Environment policies are read across pages. The variable read answers its value; the secret read answers presence by name. Only the measured `Not Found (HTTP 404)` answer means absence, and the diagnostic preserves the card's qualification about token readability. Other failures retain the read's name.

Measurement with `npm ci` and `npm test` at base `3669df48014d4e1a1062f8745f74abab14549eed`, on 2026-10-13: 3,205 tests, 3,188 passed, 17 skipped, no failures. `uptime` reported one-minute loads 3.60 before and 8.95 after; `ps -U $(id -u) | wc -l` reported 452 before. All test output was retained under the dispatch's scratch directory.

The test-first runs established the missing read APIs and diagnostic behaviours before implementation. One initial config test failed in its fixture because it tried to write a null source; that was corrected before obtaining the intended red. The affected-file run through `npm test` then passed 294 tests with no failures. Its `uptime` loads were 2.36 before and 4.05 after, with 387 user processes before. The pull request carries each failed run's output and the final-head verification.

A full run of the intermediate working tree based on that ref exposed the fixture-interface gap: `the fake repository's reads are exactly the repository read side's, compared both ways` failed because the in-process fake lacked the three environment reads. The suite reported 3,251 tests, 3,233 passed, 17 skipped and that one failure. Its loads were 2.80 before and 9.25 after, with 396 user processes before. The existing assertion remains intact. The fake gains the methods and an environment seed argument, and an added test compares present and absent answers through the executable fake against its in-process answers.

The final affected-file run passed 335 tests, with no failures: `doctor`, the forge read side, fake `gh`, and the layer-boundary tests. Its loads were 4.57 before and 6.05 after, with 409 user processes before. The intermediate full run's worktree and local-branch listings were equal before and after. The coordinator granted the one existing fixture signature change in [C33](https://github.com/williacj/rigger/issues/659#issuecomment-6157006522); the existing fixture-interface assertion remains unchanged.

The post-grant full suite passed 3,253 tests: 3,236 passed, 17 skipped and none failed. `uptime` reported one-minute loads 2.98 before and 16.35 after; `ps -U $(id -u) | wc -l` reported 481 user processes before. Its complete output is retained in the dispatch's scratch directory.
