ABOUTME: Records card #1074's attempt decision context fix and the controlled event evidence.

# The decision carries the failure's dispatch

Done for #1074 means each in-scope Table A row and decision records the dispatch of the
preceding failure, including absence before any dispatch and the second dispatch on a hold.
The card's acceptance revision is `311e250244b8`.

The pre-code search `rg -n 'attempt.decided|failedAttempt\(' src/` found the workspace, maker,
required-step and judge callers, and one decision emission. Opening their arguments showed
that the maker, step and judge paths already hand the failure its dispatch. The decision used
a separate emitter without that context. Both events now use the failure's emitter.

The test reads the real sink's JSONL through `readEvents`, checking adjacent failure/decision
pairs. Its named cases cover maker start failure, maker scratch refusal, required steps that
never start, exit nonzero or time out, judge start failure through `judgeAnswer`, and workspace
failure or refusal. Distinct first and second dispatch ids discriminate a hold using its first
failure's id. Workspace stop follows a dispatched maker failure, discriminating inherited
context where the latest failure has none. The test claims R-RECORD-7.

Measured with `npm ci && npm test` at base `2b6d64f3cec10848cfda2912b6985e41e63d3cc7`
on 2026-10-28: tests/pass/fail = 3767/3767/0; start/end one-minute load = 5.60/8.46.
The named test run before the source change reported tests/pass/fail = 21/4/17, with all
dispatch-bearing cases failing `attempt.decided dispatch` because the recorded value was
undefined. After the emitter change, the same target reported 21/21/0. The affected-file run
reported 180/180/0. Complete outputs are retained in the dispatched scratch directory as
`1074-baseline.log`, `1074-red.log`, `1074-green.log` and `1074-affected.log`.

`npm run matrix` regenerated the requirement row, and `npm run matrix:check` passed on the
working tree. Existing test lines are unchanged. The PR records the committed-head full-suite,
host-tier, fresh-clone, mutation-receipt and proof-diff evidence required by the dispatch.
