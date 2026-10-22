ABOUTME: Separates suite-reaper fixture setup from E2's real cancellation timer and records prospective proof.

# Ready fixtures before cancellation

Card #762's PM replacement acceptance and base-specific source grant are recorded on the
[card](https://github.com/williacj/rigger/issues/762) and its
[grant](https://github.com/williacj/rigger/issues/762#issuecomment-6344209617).
The owner authorized the bounded redesign in the
[scope record](https://github.com/williacj/rigger/issues/881#issuecomment-6343651005).

E2's enclosing generated test used to start its one-second timeout before fixture setup.
The generated test now publishes the invocation, fixture kind, positive PID and host process
identity. Its caller independently reads the host's live process identity before acknowledging
readiness. F4 includes its leader and member; F7 includes its group. A nested holding test starts
the real one-second node:test timer after that acknowledgement. The caller's setup boundary,
checkEnding cleanup boundary and existing outer test bounds retain their previous values.

One local waiter serves both runEnding and controlled protocol tests. Missing and malformed
publications wait only to the setup boundary. A stale invocation, foreign fixture, absent
process or reused PID fails setup without entering cleanup proof. The waiter distinguishes
setup cancellation from a cancellation after accepted readiness. Failure teardown awaits the
recorded suite shell and sweeps its fixture directory; cleanup errors remain failures.

The delayed-setup regression holds an actual generated E2 setup gate through the former timeout
window, using a monotonic-clock condition and event-loop turns. Cancellation is checked before
a later fixture spawn. This is a prospective reproduction of premature cancellation, not
evidence for the cause of any historical occurrence. Historical causes and missing originals
remain unresolved.

## Measurements

The following commands were run with Node 26.12.0 in Ubuntu WSL2 against the card's worktree,
based on 55df9e6fae91b5a026a8ab89c6f56b6a99682a3e. Complete originals are retained in the local
card evidence directory, outside the disposable suite directories.

- Before changing the E2 timeout placement, the additive delayed-setup regression failed:
  the actual generated test cancelled at its real 1,000 ms setup timer, and runEnding's
  readiness assertion failed. Original: base-delayed-setup.tap.
- After the minimal phase split, the same real gate regression passed with no cancellation
  of the outer test. Original: head-delayed-setup-phase-split.tap.
- The new waiter initially accepted a valid record first observed after its setup deadline.
  The boundary assertion failed with “Missing expected rejection”; checking the deadline
  before observing another publication made it pass. Originals: readiness-cutoff-red.tap
  and readiness-cutoff-green.tap.
- The controlled readiness and actual setup/hold parent-abort checks passed.
  Original: readiness-focused.tap.
- The complete affected host file, sh test/suite.sh --host test/suite-reaper.test.mjs,
  passed 77 tests with zero failures, cancellations or skips. This includes the existing
  F1-F7 by E1-E7 cases and the E6 delayed complete-positive-file-PID control.
  Originals: suite-reaper-host.tap, suite-reaper-final-host.tap and the final-source
  suite-reaper-reviewed-host.tap.

These Linux results do not claim a macOS runtime result. The existing real recipes and
checkEnding process-absence and run-directory-removal assertions remain in place.

The identity read requests untruncated command text, following the process adapter's host
command reads, and fixes the observation locale and timezone for the host start-time field.
Ordinary npm test passed 2,614 tests with zero failures or cancellations and nine skips.
The required matrix and package-budget checks and the tracked-file header check passed.
