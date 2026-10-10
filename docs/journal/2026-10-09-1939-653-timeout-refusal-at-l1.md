<!-- ABOUTME: Records why the continuing workspace timeout test crosses L1 and how it caught a swallowed fetch timeout. -->

# Continuing workspace timeout refusal at L1

Round 1 on PR #704 found that the timeout test reached L0 alone. A continuing attempt could swallow L0's timed-out fetch, remove the earlier worktree, and still satisfy both affected test files. The proposed requirement's timeout row asks for L1 to refuse the attempt, name the workspace path, and leave its contents alone.

The added L1 test makes an earlier card worktree, leaves an uncommitted file in it, and runs the next attempt with a local Git fixture whose fetch outlives its timeout. `makeWorkspace` passes an optional timeout to L0's existing adapter so this test can use the fixture's one-second bound; ordinary calls keep L0's default. The test asserts `WORKSPACE_NOT_MADE`, the path, the timed-out fetch, and byte-identical directory contents.

I applied the judge's m7 mutation with a guarded replacement and read back the source diff. `npm test -- test/workspace.test.mjs` ran 100 tests and failed only the new test: `AssertionError [ERR_ASSERTION]: the attempt made a workspace` at `test/workspace.test.mjs:160`. After restoring m7, `npm test -- test/workspace.test.mjs test/worktrees.test.mjs` passed 145 of 145 tests. Both runs used `TMPDIR=/Users/cjwilliams/GitHub/rigger-worktrees/codex-653-tmp/653-r2`; `uptime` reported one-minute loads 5.54 before the red run and 4.51 before the green run on 2026-10-09.

The first full precommit run started at one-minute load 11.33 and ended at 30.26. It exited nonzero because `test/judge-dispatch.test.mjs:309` hit its 60-second bound, with output `test timed out after 60000ms`; its existing root-cause card is #622. A second full run started at 17.48 and ended at 37.09 and exited zero: 2,574 tests, 2,557 pass, 17 skipped. These figures are `uptime` and `npm test` measurements on the working revision on 2026-10-09.
