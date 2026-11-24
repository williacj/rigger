<!-- ABOUTME: Records card 1466's round-five standalone fixture repair and its verification evidence. -->

The completion condition for this revision is reviewer F1 on PR #1475, comment
7100219499: preserve the existing standalone warm runner while retaining the tracker fixture.
The coordinator granted this repair as M8-K57. Acceptance remains K7 f5f416c9b828;
item 27 remains pending owner-requested full_host under M8-U39/U94.

The fault class is an eager dependency on a production module in a standalone fixture.
The existing warm-runner test copies three test modules without src/. Its unchanged case
failed with ERR_MODULE_NOT_FOUND before the fix and passed after it. trackerWorld now loads
the same production host synchronously when invoked, through Node's createRequire, leaving
the copied warm runner independent of that host. No production code or assertion changes.

Measurements on 2026-11-23 UTC, at 8c996332 plus this fixture edit, used npm test through
the repository harness with the external TMPDIR specified by the dispatch. Complete output,
commands, refs, UTC timestamps, exits and one-minute loads are retained under
/Users/cjwilliams/GitHub/rigger-worktrees/codex-1466-tmp/:

- 1466-r7-standalone-red.log: unchanged warm-runner case, exit 1, tests=1,
  pass=0, fail=1; load=1.42 at start and end.
- 1466-r7-standalone-green.log: same case, exit 0, tests=1, pass=1;
  load=1.28 at start and end.
- 1466-r7-tracker-host-green.log: T8/T11, exit 0, tests=110, pass=110;
  load=1.19 at start and end.
- 1466-r7-tracker-deterministic-green.log: ordinary descendant decision matrix,
  exit 0, tests=7, pass=7; load=1.92 at start and end.
- 1466-r7-tracker-green.log: an invalid combined host invocation, exit 1 before
  tests because exit-budget.test.mjs is not host-listed. It receives no proof credit;
  the two correctly tiered runs above replace it without erasing the failed attempt.

1466-r7-consumers.txt records the recursive reverse import graph and its intersection
with the suite's host list: 39 affected host files. 1466-r7-fault-search.txt records
the standalone copy consumer, the production-host dependency and the tracker fixture.
proof-repository.mjs also copies the helper but supplies src/. Existing-line grants remain
G1–G8: this revision edits only card-added lines in process-fixtures.mjs. The full diff
against origin/main is retained as 1466-r7-test-lines.diff.

Final-head evidence belongs in the PR body: slot-wrapped commit verification, affected
host files, push, a fresh published-head clone, CI and preflight. The coordinator dispatches
independent judges. The maker does not merge or change labels. Linux remains unproved.
