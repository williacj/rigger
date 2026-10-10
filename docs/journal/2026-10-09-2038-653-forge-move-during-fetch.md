<!-- ABOUTME: Records the L1 test that proves a forge-head move during fetch leaves a continuing workspace unchanged. -->

# Forge move during fetch

Round 2 of PR #704 found that the existing moved-head test pushed before L1 began, so it did not exercise the second forge-head comparison in L0. The proposed `R-WORK-25` state also covers a move while the fetch runs. Production already performed that comparison; its missing proof was a test.

The added L1 test prepares a second local commit without pushing it. A Git stand-in pushes it to the local bare forge when L0 starts its fetch, after the first forge-head read. The test requires `WORKSPACE_NOT_MADE`, both commit names, the workspace path, and unchanged earlier contents and `HEAD`. It checks the forge holds the second commit after the attempt.

I applied the judge's one-line mutation removing only the comparison after fetch. I counted its anchor, read back the source and diff, and ran `npm test -- test/workspace.test.mjs` on 2026-10-09 with `TMPDIR=/Users/cjwilliams/GitHub/rigger-worktrees/codex-653-tmp/653-r3`: 101 tests, 100 pass, 1 fail. The new test failed with `AssertionError [ERR_ASSERTION]: the attempt made a workspace` at `test/workspace.test.mjs:160`. The one-minute `uptime` load was 6.92 at start and 17.56 at end. After restoring the source byte-for-byte, `npm test -- test/workspace.test.mjs test/worktrees.test.mjs` passed 146/146; start/end loads were 18.87/34.73. No production source changed in this revision.
