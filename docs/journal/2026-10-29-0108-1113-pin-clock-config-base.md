ABOUTME: Records the historical validator pin and regression proof for hotfix card 1113.

# Pin the clock configuration oracle

Card #1113, acceptance revision `f33d89768a61`, authorizes a retarget under
M7-K20 grant class 1. The helper now imports the validator at
`f22c69452ff2b5979af24b745d6a3c4573ef9592`, the formatter fix merge's first
parent. It checks the commit object locally and fails explicitly when the clone
lacks it. It never fetches history.

Before the edit, `npm test -- --test-timeout=60000 test/clock-config.test.mjs`
at base `8bb1e80a6983d21d88fe145f609a89a15c093b29` reported `tests 25`,
`pass 24`, `fail 1`: C30 failed with “no shared-formatter throw was probed at
the base”. The one-minute load measured by `uptime` was 3.35 at both ends.
The complete output is retained as `1113-base-red.log` in the dispatch scratch
directory's `1113-evidence/` directory.

The new regression test was written and run before changing the helper.
It failed with “Missing expected exception: the pinned base must throw from
holdsNothing”; the existing C30 failure also remained. That run reported
`tests 26`, `pass 24`, `fail 2`, at one-minute load 2.61 at both ends.
Its complete output is `1113-test-first-red.log` beside the baseline log.

After the pin, the same named-file command reported `tests 26`, `pass 26`,
`fail 0`, at one-minute load 2.33 at both ends. C30's diagnostic named the
pinned base, 146 paths, 1658 answered probes and a non-empty `sharedSites`.
Those are measurements from `1113-focused-green.log` on the working tree
containing this entry. The new test checks both the historical throw and the
first-parent relation using git's own answer.

The full deterministic run through `suite-slot.sh 1113-maker -- npm test`
reported `tests 3918`, `pass 3918`, `fail 0`, with one-minute load 2.13 at
start and 4.51 at end. Its unfiltered output is `1113-full-local.log` in the
same evidence directory. Package budget and matrix checks also passed.

The pre-edit search `rg -n 'clock-config|pin-clock-config-base|baseValidator'
test/` found only this file's helper and its three original callers. Searching
`test/` for journal references found generic path and header fixtures, with no
coupled content requiring another changed path. The only existing test lines
changed are base lines 23 and 25–27, all inside grant class 1. Existing assertions
and requirement declarations are unchanged; this repair adds no requirement
claim. Final suite, historical-pin mutation, shallow-clone refusal, absent-ref
clone and CI evidence belong to the PR body at its final head.
