ABOUTME: Records the suite-reaper family premise mapping and the bounded group/cwd observation correction.

# Observed fixture premises

Card #788's [acceptance and bounded source grant](https://github.com/williacj/rigger/issues/788#issuecomment-6346170058)
name comparison head 6bbae2b12c3d49c1a04383600a5cf21fa6d62e13. Its source already checked
each recorded process identity and liveness. It did not require F3's actual process group
to equal its tail PID, or F5's actual detached group and working directory to match the
fixture premise. The helper recipes express those intentions but are not observations of
the live relations.

The correction keeps the recipes and adds only those relation checks. F3 and F5 use the
existing ps group observation. F5 also reads the live process's cwd through lsof and compares
it with the intended working path published by the unchanged recipe's generated test.
Both host reads consume the existing shared setup deadline, including the post-observation
deadline and cancellation checks. No second deadline or grace period is introduced.

The relevant source is test/suite-reaper.test.mjs: runEnding generates the recipes and
publishes readiness; readinessProcess reads host facts; waitForReadiness checks them before
acknowledging readiness or taking an ending action.

| Family | Premise and actual observation |
|---|---|
| F1 | The busy fixture writes its alive marker. Its published child PID must have the independently observed live host identity. |
| F2 | The recipe awaits its parent's exit, reads the tail PID, and requires that tail's independent live host identity. |
| F3 | The recipe awaits its parent's exit and requires the recorded tail's independent live host identity and actual PGID equal to its PID. |
| F4 | The recorded leader and member must each have their independently observed live host identity. |
| F5 | The recorded detached tail must have its independent live host identity, actual PGID equal to its PID, and actual cwd equal to its intended working path. |
| F6 | The agent's held(1) condition precedes publication of its child PID, which must have the independently observed live host identity. |
| F7 | The alive marker and onGroup publication precede the live host identity check; the actual group must match the published leader PID. |

All existing F1-F7 recipe bodies, the 49 family declarations, ending targets, E6 delayed
positive-file-PID control, checkEnding assertions and #762 deadline/cancellation regressions
remain in place. Missing readiness earns no completed-family-cell credit.

## Measurements

The maker prepared this work at 6bbae2b using the coordinator's offered independently green
baseline; the unchanged expensive baseline was not rerun by this maker. The following are this
maker's measurements on the card worktree's scoped delta, using Node 26.12.0 in Ubuntu WSL2.
Complete command originals are retained in the private card evidence directory.

- The three wrong-premise controls first failed with “Missing expected rejection”: F3 wrong
  group, F5 wrong group and F5 wrong cwd were accepted. No test was cancelled.
  Command: sh test/suite.sh --host --test-name-pattern='tail that does not lead|tail outside its intended' test/suite-reaper.test.mjs.
  Original: premise-controls-red.tap.
- After enforcing the relations, those three controls and every real F3/F5 ending cell passed:
  17 tests, zero failures or cancellations. This crosses the actual ps and lsof boundaries for
  the real fixtures.
  Command: sh test/suite.sh --host --test-name-pattern='tail that does not lead|tail outside its intended|ends an F[35]' test/suite-reaper.test.mjs.
  Original: premise-controls-and-family-green.tap.

Historical occurrence causes and unavailable originals remain unresolved. These local results
claim no macOS runtime result. Card #788 remains open until #762's prerequisite disposition
and the finite final-head proof and independent review are complete.

The final complete affected file passed through sh test/suite.sh --host
 test/suite-reaper.test.mjs: 85 tests, zero failures, cancellations or skips,
20,971.583159 ms (final-full-host.log). The executed source was retained before
that run as final-85-run.test.mjs with SHA-256
e30cc6b70e6428310e72825d1c89aee6d31c4cfe5c68024d71b558eb854153be.
This includes both additional cwd-budget controls and all 80 prerequisite tests.
The normal commit hook supplies final ordinary-suite verification, recorded
with the resulting head in the pull request.
