<!-- ABOUTME: Records the pre-run boundary analysis and safe diagnostic protocol for card #1109. -->

# Nested ownership observation, card #1109

## Pre-run source and historical evidence

The [PR #1079 N2 judge receipt](https://github.com/williacj/rigger/pull/1079#issuecomment-6478795003) reports a personal-Mac failure at `3d8644d53c0498fa0343dea3dbe0c36c61272e5e` in `nested ownership real close: answered, live descendant`. Its post-SIGKILL targeted read retained the requested PID and recorded birth, reported live state and command `(node)`, and reached `recorded descendant identity changed after signal`. That receipt establishes one observation, not that the descendant ended or why the command changed. No personal-Mac run supplies this card's hosted evidence.

At maker base `17dbbf5a78723608c2641447cfd334ddc4e0767b`, `git hash-object test/never-stop.test.mjs` returned `0a8b7e84d80ab4bd9ebc35ecdfd4d4e63927e8dc`. `nestedProcessIdentity` requests `ps -ww -p <requested PID> -o lstart=,stat=,command=`, applies the existing absence rule, and parses birth, state and command. That output has no PID column. `endNestedDescendant` guards the recorded PID, birth and live command before SIGKILL and again after it. `realOwnershipRun` owns the three named real-close cases and their final descendant read. The probe stays at those test boundaries; it does not change their result or Rigger production code.

## Controlled observation map

| Input after SIGKILL | Safe class | Existing cleanup result |
|---|---|---|
| Same birth, live command unchanged | `live-matching` | Continue reading within the existing bound |
| Same birth, live command changed to `(node)` | `live-changed-command` | Identity refusal |
| Same birth, zombie with changed command | `zombie` | Terminal zombie |
| Existing absence-rule answer | `absent` | Terminal absence |
| Changed birth | `birth-mismatch` | Identity refusal |
| Changed PID from the injected observer | `changed-pid` | Identity refusal; never attributed to the real `ps` output |
| Malformed, errored, aborted or unanswered read | `unconfirmed` | Existing refusal |

The signal call is recorded separately as `returned`, `ESRCH`, `EPERM` or `other`. A returned signal supplies no ending credit. Controlled fake `ps` answers exercise the parser and a distinctive private path exercises the output boundary; injected observer cases exercise the changed-PID path that the real targeted `ps` answer cannot report.

## Safe-record protocol

Only a named `nested ownership real close` case emits new diagnostic lines. A `nested.identity` line names the case, the numeric requested PID and its `requested` source, phase, increasing read sequence, available `ps` status/signal/allowlisted error class, read outcome, state class, and birth/command match classes. The first line covers the recorded descendant, subsequent lines preserve every cleanup read including repeated live answers, and a final line covers the fixture's final read if reached. A separate `nested.signal` line carries only the signal result class. New lines carry no command, cwd, path, environment, raw stream or digest of those values. Existing test failure output is outside the new-line claim.

The terminal `nested.evidence` line carries expected and emitted read counts plus `complete` or `incomplete` for the outer case's local safe records. The post-run report must compare the actual emitted lines and sequence with that footer, and must mark a missing footer, a gap, a malformed/truncated line, or a record too limited to separate alternatives as incomplete evidence. An absent line cannot label itself. This is an observation protocol; the fixture's existing assertion determines pass or fail.

## Pre-run verification

At the unchanged maker base, a fresh Ubuntu WSL clone using Node `v26.12.0` and locked dependencies passed `npm test`: 3,858 tests, 3,849 passed, zero failed, zero cancelled, nine skipped. The affected `npm run test:host -- test/never-stop.test.mjs` baseline passed: 639 tests, 615 passed, zero failed, zero cancelled, 24 skipped. These are local Linux measurements at base `17dbbf5`, not hosted macOS results or reviewed-head checks.

Focused red/green controlled checks on the uncommitted diagnostic work have exercised changed live command, repeated live reads, targeted `ps` privacy, absence, zombie, birth mismatch, injected PID mismatch, signal result classes, malformed and errored reads, aborted and unanswered reads, named real-close output, and missing/truncated safe-line classification. A later reviewed-head full deterministic and affected host check remains required before handoff. No hosted `ci:full` result is claimed here.
## Local candidate evidence

The owner-approved #1109 declaration exception leaves the new diagnostic-only controls without `// proves` claims. `npm run matrix:check` passed on the candidate, and the generated matrix has no base-to-head diff.

A guarded local mutation changed the diagnostic classifier's one `live-changed-command` return to `absent`; its exact anchor count was one, and readback plus `git diff` showed the replacement. The named controlled test `nested ownership diagnostic records changed live command after SIGKILL without ending credit` ran alone and failed its state assertion: after-signal actual `absent`, expected `live-changed-command`; one named test, one failure, zero cancellations. The unchanged cleanup still refused the changed live command. The original test source was restored byte-exact (SHA-256 `a46783d98e676471b16b4a3f4ee1cff2bb844c094f7333d847931ef4ec91fec7`), and that same named test passed alone. This was a local Linux WSL diagnostic-control mutation, not a hosted Mac result.

At the restored candidate with Node `v26.12.0` in Ubuntu WSL, `npm test` passed 3,858 tests with 3,849 passed, zero failed, zero cancelled and nine skipped. `npm run test:host` passed 2,180 tests with 2,131 passed, zero failed, zero cancelled and 49 skipped. The host run was local Linux, so it establishes the candidate's local host behavior only. The configured hosted macOS `full_host` job remains the acceptance authority for the three real-close cases.
