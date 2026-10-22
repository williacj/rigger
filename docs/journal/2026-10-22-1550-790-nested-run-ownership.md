ABOUTME: Card #790's bounded nested-run ownership change, its current proof and unresolved historical causation.

# Nested runner ownership

The maker base is `06b4bcf`. The approved #790 source grants refer to `55df9e6`;
`git diff 55df9e6 06b4bcf -- test/never-stop.test.mjs` returned no changes.
Only the named test file and this journal change.

The four nested callers now share an unexported ownership helper. It records the direct child
returned by spawn, creates its process group, initiates group cleanup synchronously on parent
abort while that child remains live, and observes close before treating early-abort cleanup as
complete. An exited child no longer authorizes signalling its former group, even while inherited
output still delays close. Spawn errors retain their original error. Cleanup failures retain the
original outcome, their diagnostic and captured output. Combined output is not a causal ordering
between stdout and stderr.

Normal C615 callers retain their selected patterns, observer configuration, evidence parsing and
assertions. Explicit regression contexts replace the command boundary with controlled children or
small real payloads. Only those payloads record an additional descendant at spawn. Before each
descendant PID signal its birth and full command are checked against that record; no process-table
census or arbitrary descendant registry was added. A final zombie is ended, without a claim that
this parent reaped it. The OS birth field has second precision; these checks do not claim a
collision-free PID-reuse identity. A direct child is separately observed closed and reaped.

No cleanup grace or larger bound was added. Early controlled parent cancellation leaves the
containing test's existing signal available to bound completion observation. Actual node:test
timeout is separately tested for synchronous initiation with a controlled child whose start and
abort listener installation are asserted before the timer can fire. One stderr writer establishes
that decision ordering. Real ready payloads establish OS termination, separately.

## Evidence

Measurements below are from Linux WSL, Node v26.12.0, on 2026-10-22. Complete command outputs,
recorded PIDs and birth/command observations are retained outside the checkout under the card's
private evidence directory.

| Attempt | Command or target | Result |
|---|---|---|
| Listing baseline | node --test --test-name-pattern='^nested ownership listing abort ends its recorded runner$' test/never-stop.test.mjs | Intended red: ready runner remained live after cancellation; own cleanup subsequently killed its recorded group and awaited close |
| Listing fix | Same target | One pass, no failures or cancellations; recorded child closed and reaped |
| Recorded descendant | named close-cleans-only regression | Intended red for missing per-PID cleanup, then green retaining nonzero status |
| Exit before stream close | named exit-before-stream-close regression | Intended red for signalling the exited runner's former group, then green |
| Cleanup output | named cleanup-refusal-preserves regression | Intended red for missing output evidence, then green |
| Refused cleanup | named refused-signal-fails regression | Intended red for waiting indefinitely on a close it could not cause, then green without reaping credit |
| Missing close | named missing-runner-close regression | Intended red for ignoring the enclosing observation bound, then green |
| Final controlled contract | controlled-final.log | 25 passes, zero failures, cancellations or skips |
| Caller and OS boundary | real-wiring-first.log | 42 passes, zero failures, cancellations or skips; twenty caller wiring cases, twelve real payload cases, eight real containing-harness cases, one deadline-initiation case and the original listing regression |
| Structural checks | npm run matrix:check; npm run budget:package | Both exit zero; matrix reports the existing 75 of 218 counted gaps; production package remains 6,459 lines against 12,000 |
| Declared-base replay | listing-declared-base-red.log plus retained original/base-regression/head source bytes and diff | The same intended ready-runner assertion failed on the declared base with only its additive test seam; candidate source restored byte-for-byte |
| Initial complete affected file | affected-host-final.log | 657 total, 633 passes, zero failures/cancellations, 24 skips; 450,396.761387 ms |
| Initial deterministic suite | ordinary-final.log | 2,623 total, 2,614 passes, zero failures/cancellations, nine skips; 53,719.057545 ms |
| Enclosing-bound diagnostic | post-bound-diagnostic-red.log; terminal-and-bound-red.log | An additional signal after the controlled enclosing bound was observed; the strengthened repository assertion failed, then passed after a pre-observation bound check |
| Zombie authority | zombie-authority-red.log | Own start-recorded runner was stopped; its revalidated descendant became Zs with unchanged birth but command replaced by [node-MainThread] <defunct>; raw ps status/stdout/stderr retained; current classifier rejected it |
| Corrected terminal contract | terminal-zombie-red.log; controlled-final-corrected.log | Replaced-command zombie cases failed first; corrected controlled set has 28 passes and zero failures/cancellations/skips, including changed-birth rejection |
| Existing static guards | static-env-audit.log | Both existing spawn/import/environment audits pass; an initial nonexistent filename attempt is retained and earns no test credit |

A guarded source edit initially refused its expected anchor and wrote nothing. An initial syntax
check attempted Node without its WSL installation on PATH and did not run. Neither is test red
or bug evidence. All meaningful failed regression attempts remain retained beside their green
reruns.

The first full candidate passed its existing assertions but still had the two narrower defects
found during source/authority investigation. Those defects are fixed in this work; the initial
full runs above are retained as initial-candidate evidence, and earn no final-head verification
credit. The real zombie authority check is also retained as a host regression. A zombie's command
need not remain its live command, so terminal classification checks its recorded birth before
accepting the ended state; every live descendant signal still checks its full recorded command.

The final source also makes the identity reads asynchronous and gives each read the containing
test's existing AbortSignal. The direct tool child is recorded at spawn, ended with SIGKILL on
abort, and observed closed before the read rejects. No synchronous ps read was added to the
ownership path. A read consumed after its observation signal ends earns no terminal or absence
credit, while retaining the tool's original fields. The real payload stays in its created group
through identity preparation; a close-with-descendant payload waits for acknowledgement that its
identity was recorded before it exits.

The actual tool test first exposed an API assumption. On this installed Node v26.12.0,
execFile forwarded AbortSignal but omitted killSignal when calling spawn, so the attempted
SIGKILL abort actually ended the tool with SIGTERM. The failed run and installed native
child_process source are retained. Direct spawn's signal path was checked in that source and
then crossed for real: the recorded tool closed with SIGKILL and was reaped. No result from the
SIGTERM attempt is called a SIGKILL result.

| Settled-source measurement | Original | Result |
|---|---|---|
| Same-turn close before abort | close-before-abort-red.log; close-before-abort-green.log | Intended red for losing exit 7, then green after choosing the outcome by observed event ordering |
| Before-decision observation bound | post-await-bound-red.log; post-await-bound-green.log | Both initial and post-signal returned reads first earned terminal credit after their containing signal expired; strengthened assertions red, then green with post-await checks |
| Actual hanging observer | observer-abort-red.log | Intended red: readiness established but observation abort did not initiate tool cleanup; own recorded-tool cleanup completed |
| execFile abort attempt | observer-abort-green.log | Failed at the requested SIGKILL assertion: actual close signal was SIGTERM; retained as a failed API assumption |
| Direct-spawn observer | observer-abort-spawn-green.log | One pass; recorded child closed with SIGKILL and was reaped, preserving the original cancellation cause |
| Observation originals | observer-originals-red.log | Aborted, answered-at-cancellation and nonzero reads first lacked their required original fields/cause |
| All focused source contracts | all-focused-corrected.log | 85 total passes, zero failures/cancellations/skips, 3,607.844049 ms; all 81 added cases and four unchanged original leak callers |
| Settled static and structural checks | static-env-settled.log; matrix-settled.log; package-budget-settled.log | Both existing static audits and required matrix/package checks exit zero; existing gap count and production budget unchanged |

The settled-source focused run includes the real zombie authority regression, all four entry
points' five wiring checks, direct/descendant real abort cases, real close-with-descendant cases,
bounded containing-harness successes and failures, and actual node:test deadline initiation.
Complete initial, failed and passing originals remain separate. The final complete affected-file
run measured 667 tests: 643 passed, zero failed or cancelled, 24 skipped, 450,806.473179 ms
(affected-host-settled.log). Its frozen source SHA-256 is
87e29df84682a5ea28c01ea90beaa74d8473c91421f3c80b1765fff0ce63cbe3.
The normal commit hook supplies final deterministic verification, recorded in the offered PR.

## Scope and remaining proof

The approved old-line grant classes are N1 for lifecycle lines, N2 for local extraction and
explicit regression seams, N3 for imports/ownership comments, and N4 for additive bounded leak
harness modes. Existing C615 assertions, evidence/privacy checks, fixture recipes, deadlines,
proves declarations and original leak modes remain intact.

These results prospectively prevent the observed local ownership failures. They do not establish
the cause of historical CI run 38947643018. That occurrence remains unresolved. Linux OS tests
earn no macOS ps/lsof/census proof; existing platform-gated callers still require supported macOS
CI. Independent review and final full-file/suite verification are recorded with the offered head.
