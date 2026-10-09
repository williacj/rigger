<!-- ABOUTME: Records the integration of the post-kill proof with the marked-read controls. -->

# Integrating the marked-read controls

Main's #691 work gives its first-live and third-read controls an ordered trace through `directoryReadCell`. Card #689 gives the named failed-first-state proof a distinct `postKillReadCell`. Keeping these helpers separate preserves each fixture's selected answers and protected assertions. The generated test matrix follows from the resulting test declarations.

Both callers derive source from the same `CALLER` template. The first integrated affected-file run stopped while #691 looked for the original signal-call fallback. The conditional O79 replacement keeps that fallback when the #689 observer is inactive. Subsequent runs exposed two generated-module name collisions: both observers declared `trace`, and both imported `syncBuiltinESMExports` under the same name. The #689-added observer now uses a global trace function and an aliased import; #691's generated caller keeps its local ordered trace. The existing #691 helper and callers remain in place.

The integrated worktree's affected-file run passed 123 of 123 tests. Its full suite passed 2,519, failed zero and skipped 17 of 2,536 tests. These measurements came from `npm test -- test/never-stop.test.mjs` and `npm test` on the staged merge worktree on 2026-10-08. The earlier complete failed outputs remain in the private run inventory.

The original-base `r03` first-live failure remains unexplained. #691's merged no-reproduction investigation and this integrated green suite do not establish its earlier phase or a causal fix. Card #689 item 18 still needs an owner-approved disposition before PR #692 can clear review.
